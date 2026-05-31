; windows-installer.nsi
; NSIS installer for Container Cove with bundled Podman
; Requires NSIS 3.x or later with MUI2 support

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

; ============================================================================
; Configuration
; ============================================================================

; Set the product name and installer details
Name "Container Cove"
OutFile "build\Container Cove Setup 1.0.0.exe"
InstallDir "$PROGRAMFILES\Container Cove"
InstallDirRegKey HKCU "Software\Container Cove" ""

; Require admin or ask for elevation (modern NSIS)
RequestExecutionLevel user

; Compression settings
SetCompress auto
SetDatablockOptimize on
SetOverwrite try

; ============================================================================
; MUI2 Settings
; ============================================================================

; MUI Settings
!define MUI_ABORTWARNING
!define MUI_ICON "assets\icons\App_Icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "assets\icons\installer-header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "assets\icons\installer-welcome.bmp"

; Language
!insertmacro MUI_LANGUAGE "English"

; ============================================================================
; MUI2 Pages
; ============================================================================

; Installer pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ============================================================================
; Installer Sections
; ============================================================================

Section "Install Container Cove" SecInstall
  SetOutPath "$INSTDIR"

  ; Extract app executable and resources
  ; These are provided by the build script
  File /r "build\Container Cove\*.*"

  ; Extract Podman binary
  ; Podman is downloaded and prepared by the build script
  File "build\podman\podman.exe"

  ; Write installation folder to registry for uninstaller
  WriteRegStr HKCU "Software\Container Cove" "" $INSTDIR

  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\Container Cove"
  CreateShortcut "$SMPROGRAMS\Container Cove\Container Cove.lnk" "$INSTDIR\Container Cove.exe" "" "$INSTDIR\Container Cove.exe" 0
  CreateShortcut "$SMPROGRAMS\Container Cove\Uninstall Container Cove.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0

  ; Optional: Create desktop shortcut
  CreateShortcut "$DESKTOP\Container Cove.lnk" "$INSTDIR\Container Cove.exe" "" "$INSTDIR\Container Cove.exe" 0

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Write uninstall information to Add/Remove Programs
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Container Cove" "DisplayName" "Container Cove"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Container Cove" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Container Cove" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Container Cove" "Publisher" "Steven Azevedo"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Container Cove" "EstimatedSize" 512000

  DetailPrint "Installation complete!"
SectionEnd

; ============================================================================
; Uninstaller Section
; ============================================================================

Section "Uninstall"
  ; Remove installed files
  RMDir /r "$INSTDIR"

  ; Remove Start Menu shortcuts
  RMDir /r "$SMPROGRAMS\Container Cove"

  ; Remove desktop shortcut if it exists
  Delete "$DESKTOP\Container Cove.lnk"

  ; Remove registry entries
  DeleteRegKey HKCU "Software\Container Cove"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Container Cove"

  DetailPrint "Uninstallation complete!"
SectionEnd

; ============================================================================
; Installer Functions
; ============================================================================

Function .onInit
  ; Check for 64-bit Windows
  ${If} ${RunningX64}
    DetailPrint "64-bit Windows detected"
  ${Else}
    DetailPrint "32-bit Windows detected"
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ; Installation was successful
  DetailPrint "Container Cove has been successfully installed!"
FunctionEnd

; ============================================================================
; Uninstaller Functions
; ============================================================================

Function un.onInit
  DetailPrint "Preparing to uninstall Container Cove..."
FunctionEnd

Function un.onUninstSuccess
  DetailPrint "Container Cove has been successfully uninstalled!"
FunctionEnd
