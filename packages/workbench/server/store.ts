/**
 * 发布记录落在服务端文件。浏览器状态不算发布。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ReleaseRecord } from "@semantic/kernel";

export interface StoredRelease extends ReleaseRecord {
  id: string;
  projectId: string;
  createdAt: string;
}

interface FileShape {
  records: StoredRelease[];
}

export class FileReleaseStore {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  append(record: StoredRelease): void {
    const current = this.read();
    current.records.push(record);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    renameSync(temporary, this.file);
  }

  list(projectId: string): StoredRelease[] {
    return this.read().records.filter((record) => record.projectId === projectId);
  }

  private read(): FileShape {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as FileShape;
      return { records: Array.isArray(parsed.records) ? parsed.records : [] };
    } catch {
      return { records: [] };
    }
  }
}
