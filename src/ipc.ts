import { invoke } from '@tauri-apps/api/core';

// Raw IPC helpers. Commands returning `tauri::ipc::Response` on the Rust side
// arrive here as a binary ArrayBuffer instead of a JSON number array, which
// removes the ~4x serialization overhead for image payloads.

export async function invokeImageData(
  path: string,
  command: 'get_image_data' | 'get_full_image_data',
): Promise<Blob> {
  const buf = await invoke<ArrayBuffer>(command, { path });
  return new Blob([new Uint8Array(buf)], { type: 'image/jpeg' });
}

export interface ThumbnailPayload {
  blob: Blob;
  blurScore: number;
}

// Wire format (see image_loader.rs::encode_thumb_response):
// [8 bytes LE f64 blur_score][JPEG bytes...]
export async function invokeThumbnailData(path: string): Promise<ThumbnailPayload> {
  const buf = await invoke<ArrayBuffer>('get_thumbnail_data', { path });
  if (buf.byteLength < 8) {
    throw new Error('Malformed thumbnail payload');
  }
  const blurScore = new DataView(buf).getFloat64(0, true);
  const blob = new Blob([new Uint8Array(buf, 8)], { type: 'image/jpeg' });
  return { blob, blurScore };
}
