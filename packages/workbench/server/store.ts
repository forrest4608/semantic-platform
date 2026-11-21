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
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch (error) {
      // 只有文件还不存在时才当作空库。读失败或内容损坏时不能当成空库再写回去。
      if (isMissingFile(error)) return { records: [] };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`发布记录无法读取：${this.file}`);
    }
    if (!isFileShape(parsed)) {
      throw new Error(`发布记录格式不正确：${this.file}`);
    }
    return parsed;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isFileShape(value: unknown): value is FileShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Array.isArray((value as { records?: unknown }).records);
}
