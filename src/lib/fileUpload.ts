/**
 * Файл → base64 для отправки в edge-функцию.
 *
 * Загрузка больше не идёт из браузера прямо в хранилище: анон-ключ лежит в
 * бандле у каждого посетителя, и вместе с ним туда мог писать кто угодно.
 * Теперь файл уходит в admin-api (картинки магазина) или client-api (фото
 * покупателя), там проверяется личность отправителя, тип и размер, и только
 * потом запись делает service_role.
 */

/** Совпадает с лимитом бакетов и с MAX_UPLOAD_BYTES в _shared/storage.ts. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface EncodedFile {
  content_base64: string;
  content_type: string;
}

/**
 * Проверяет файл и кодирует его в base64.
 *
 * Те же правила ещё раз применяются на сервере — здесь они нужны только чтобы
 * не гонять по сети заведомо негодный файл и показать понятную ошибку сразу.
 */
export async function encodeFileForUpload(file: File): Promise<EncodedFile> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Поддерживаются только изображения: JPEG, PNG, WebP, GIF');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Файл ${(file.size / 1024 / 1024).toFixed(1)} МБ, максимум ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ`,
    );
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Порциями, а не одним spread: `String.fromCharCode(...bytes)` на файле в
  // несколько мегабайт переполняет стек аргументов и падает.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return { content_base64: btoa(binary), content_type: file.type };
}

/**
 * Ответ загрузчика.
 *
 * `path` — то, что уходит в базу. `url` — ссылка для показа: у открытых
 * бакетов постоянная, у закрытых (фото отзывов и возвратов) временная, на час.
 * Хранить в базе надо именно `path`: подписанная ссылка через час перестанет
 * открываться.
 */
export interface UploadedPhoto {
  path: string;
  url: string;
}
