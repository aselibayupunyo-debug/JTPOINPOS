import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import JSZip from "jszip";

import { apiRequest } from "@/src/api";

export async function exportBackupZip(): Promise<string> {
  const data = await apiRequest<Record<string, unknown>>("/backup");
  const zip = new JSZip();
  zip.file("kasirku_backup.json", JSON.stringify(data, null, 2));
  zip.file("README.txt", "Backup KasirKu Pro\nFile: kasirku_backup.json\nVersion: 2\nRestore lewat menu Backup & Restore di aplikasi.");
  const base64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
  const timestamp = new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 19);
  const path = `${FileSystem.cacheDirectory}kasirku_backup_${timestamp}.zip`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: "application/zip", dialogTitle: "Simpan backup KasirKu Pro" });
  }
  return path;
}

export async function importBackupZip(uri: string): Promise<{ restored: Record<string, number> }> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const jsonFile = zip.file("kasirku_backup.json") ?? Object.values(zip.files).find((f) => f.name.endsWith(".json"));
  if (!jsonFile) throw new Error("File backup tidak valid.");
  const text = await jsonFile.async("string");
  const payload = JSON.parse(text);
  return apiRequest<{ restored: Record<string, number> }>("/restore", { method: "POST", body: JSON.stringify(payload) });
}
