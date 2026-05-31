export type AppPreset = {
  image: string;
  suggestedName: string;
  description: string;
  ports: string[];
  env: Record<string, string>;
  volumes: string[];
  openUrl?: string;
  restartPolicy?: "no" | "on-failure" | "unless-stopped";
  healthcheck?: {
    cmd?: string;
    intervalSec?: number;
    timeoutSec?: number;
    retries?: number;
  };
};

const PRESETS: Record<string, AppPreset> = {
  postgres: {
    image: "postgres:15",
    suggestedName: "Postgres",
    description: "PostgreSQL database",
    ports: ["5432:5432"],
    env: {
      POSTGRES_USER: "dev",
      POSTGRES_PASSWORD: "devpassword",
      POSTGRES_DB: "devdb",
    },
    volumes: ["~/.container-cove/data/postgres:/var/lib/postgresql/data"],
    restartPolicy: "unless-stopped",
    healthcheck: {
      cmd: "pg_isready -U dev",
      intervalSec: 30,
      timeoutSec: 5,
      retries: 3,
    },
  },
  redis: {
    image: "redis:7-alpine",
    suggestedName: "Redis",
    description: "Redis cache",
    ports: ["6379:6379"],
    env: {},
    volumes: [],
    restartPolicy: "unless-stopped",
  },
  mysql: {
    image: "mysql:8",
    suggestedName: "MySQL",
    description: "MySQL database",
    ports: ["3306:3306"],
    env: { MYSQL_ROOT_PASSWORD: "devpassword", MYSQL_DATABASE: "devdb" },
    volumes: ["~/.container-cove/data/mysql:/var/lib/mysql"],
    restartPolicy: "unless-stopped",
  },
  mongo: {
    image: "mongo:7",
    suggestedName: "MongoDB",
    description: "Mongo database",
    ports: ["27017:27017"],
    env: {},
    volumes: ["~/.container-cove/data/mongo:/data/db"],
    restartPolicy: "unless-stopped",
  },
  minio: {
    image: "minio/minio",
    suggestedName: "MinIO",
    description: "S3-compatible object storage",
    ports: ["9000:9000", "9001:9001"],
    env: { MINIO_ROOT_USER: "minioadmin", MINIO_ROOT_PASSWORD: "minioadmin" },
    volumes: ["~/.container-cove/data/minio:/data"],
    openUrl: "http://localhost:9001",
    restartPolicy: "unless-stopped",
  },
};

export function presetForImage(image: string): AppPreset | null {
  const key = image.toLowerCase().split("/").pop()?.split(":")[0] ?? "";
  return PRESETS[key] ?? null;
}
