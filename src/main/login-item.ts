// Manage macOS login items via LSSharedFileList API (Bun FFI).
// Avoids the accessibility-permission requirement of osascript / System Events.

// Alias Bun's dlopen wrapper so the "dlopen" key can map to the real C symbol.
import { dlopen as ffidlopen, FFIType, read, ptr } from "bun:ffi";

const kCFStringEncodingUTF8 = 0x08000100;
const kCFURLPOSIXPathStyle = 0n; // CFIndex (int64) on LP64 macOS
const RTLD_LAZY = 1;

// Create a null-terminated UTF-8 Buffer suitable for passing as a C string pointer.
const cs = (s: string): Buffer => Buffer.from(s + "\0");

const CF = ffidlopen(
  "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
  {
    // cstring args use FFIType.ptr + explicit null-terminated Buffer (cs()).
    // Bun FFI does not auto-convert JS strings for pointer argument types.
    CFStringCreateWithCString: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.uint32_t],
      returns: FFIType.ptr,
    },
    CFURLCreateWithFileSystemPath: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.int64_t, FFIType.bool],
      returns: FFIType.ptr,
    },
    CFURLGetFileSystemRepresentation: {
      args: [FFIType.ptr, FFIType.bool, FFIType.ptr, FFIType.int64_t],
      returns: FFIType.bool,
    },
    CFArrayGetCount: {
      args: [FFIType.ptr],
      returns: FFIType.int64_t,
    },
    CFArrayGetValueAtIndex: {
      args: [FFIType.ptr, FFIType.int64_t],
      returns: FFIType.ptr,
    },
    CFRelease: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
  },
);

const CS = ffidlopen(
  "/System/Library/Frameworks/CoreServices.framework/CoreServices",
  {
    LSSharedFileListCreate: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    LSSharedFileListInsertItemURL: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.ptr,
    },
    LSSharedFileListCopySnapshot: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    LSSharedFileListItemCopyResolvedURL: {
      args: [FFIType.ptr, FFIType.uint32_t, FFIType.ptr],
      returns: FFIType.ptr,
    },
    LSSharedFileListItemRemove: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.int32_t,
    },
  },
);

// Load native dlopen/dlsym from libSystem so we can pass them a real void* handle.
// Bun's FFI wrapper cannot represent the RTLD_DEFAULT sentinel value (-2),
// so we call the C dlopen directly to get a handle we can give to dlsym.
const SYS = ffidlopen("/usr/lib/libSystem.B.dylib", {
  dlopen: {
    args: [FFIType.ptr, FFIType.int32_t],
    returns: FFIType.ptr,
  },
  dlsym: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
});

// Get a real void* handle for CoreServices (idempotent — returns the already-
// loaded handle since ffidlopen above already mapped the dylib).
const _csCStr = cs(
  "/System/Library/Frameworks/CoreServices.framework/CoreServices",
);
const csHandle = SYS.symbols.dlopen(ptr(_csCStr), RTLD_LAZY);
if (!csHandle) throw new Error("dlopen CoreServices failed");

// Read an exported CF constant by dereferencing the symbol's address.
// dlsym returns the address of the global variable (a pointer-to-CFTypeRef);
// read.ptr dereferences one extra level to yield the actual CFTypeRef value.
function readConstPtr(name: string): bigint {
  const nameBuf = cs(name);
  const addr = SYS.symbols.dlsym(csHandle, ptr(nameBuf));
  if (!addr) throw new Error(`dlsym: symbol not found: ${name}`);
  return read.ptr(addr);
}

// Resolved once at module load — CoreServices is already mapped above.
const kLSSharedFileListSessionLoginItems = readConstPtr(
  "kLSSharedFileListSessionLoginItems",
);
const kLSSharedFileListItemBeforeFirst = readConstPtr(
  "kLSSharedFileListItemBeforeFirst",
);

/** Add or remove the app bundle at `appPath` from the macOS login items list. */
export function setLoginItem(appPath: string, enabled: boolean): void {
  const list = CS.symbols.LSSharedFileListCreate(
    null,
    kLSSharedFileListSessionLoginItems,
    null,
  );
  if (!list) throw new Error("LSSharedFileListCreate returned null");
  try {
    if (enabled) {
      _add(list, appPath);
    } else {
      _remove(list, appPath);
    }
  } finally {
    CF.symbols.CFRelease(list);
  }
}

function _add(list: bigint, appPath: string): void {
  // Remove any stale entry first to prevent duplicates.
  _remove(list, appPath);

  const pathCStr = cs(appPath);
  const pathRef = CF.symbols.CFStringCreateWithCString(
    null,
    ptr(pathCStr),
    kCFStringEncodingUTF8,
  );
  if (!pathRef) throw new Error("CFStringCreateWithCString failed");
  try {
    const urlRef = CF.symbols.CFURLCreateWithFileSystemPath(
      null,
      pathRef,
      kCFURLPOSIXPathStyle,
      true, // isDirectory — .app bundles are directory bundles
    );
    if (!urlRef) throw new Error("CFURLCreateWithFileSystemPath failed");
    try {
      const item = CS.symbols.LSSharedFileListInsertItemURL(
        list,
        kLSSharedFileListItemBeforeFirst,
        null, // display name — use default
        null, // icon — use default
        urlRef,
        null, // properties to set
        null, // properties to clear
      );
      if (item) CF.symbols.CFRelease(item);
    } finally {
      CF.symbols.CFRelease(urlRef);
    }
  } finally {
    CF.symbols.CFRelease(pathRef);
  }
}

function _remove(list: bigint, appPath: string): void {
  const normalizedTarget = appPath.replace(/\/$/, "");
  const seed = new Uint32Array(1);
  const snapshot = CS.symbols.LSSharedFileListCopySnapshot(list, ptr(seed));
  if (!snapshot) return;
  try {
    const count = CF.symbols.CFArrayGetCount(snapshot);
    for (let i = 0n; i < count; i++) {
      const item = CF.symbols.CFArrayGetValueAtIndex(snapshot, i);
      if (!item) continue;

      const urlRef = CS.symbols.LSSharedFileListItemCopyResolvedURL(
        item,
        0,
        null,
      );
      if (!urlRef) continue;
      try {
        const buf = Buffer.alloc(4096);
        const ok = CF.symbols.CFURLGetFileSystemRepresentation(
          urlRef,
          true,
          ptr(buf),
          4096n,
        );
        if (ok) {
          const itemPath = buf
            .toString("utf8")
            .replace(/\0.*$/, "")
            .replace(/\/$/, "");
          if (itemPath === normalizedTarget) {
            CS.symbols.LSSharedFileListItemRemove(list, item);
            break;
          }
        }
      } finally {
        CF.symbols.CFRelease(urlRef);
      }
    }
  } finally {
    CF.symbols.CFRelease(snapshot);
  }
}
