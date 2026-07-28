/** R2 操作封装 公开桶 `r2.granodiorite.ferris.love` 直接映射到这个存储桶。存储键由调用方提供（含 `minecraft/` 等前缀）。 */

/** 检查对象是否存在并返回元数据 */
export function head(bucket: R2Bucket, key: string): Promise<R2Object | null> {
  return bucket.head(key);
}

/** 获取对象体 */
export function get(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

/** 上传对象（小文件） */
export function put(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer | string,
  options?: R2PutOptions,
): Promise<R2Object> {
  return bucket.put(key, body, options);
}

/** 流式上传：从源站拉取的同时写入 R2 */
export function put_stream(
  bucket: R2Bucket,
  key: string,
  stream: ReadableStream,
  content_type?: string,
): Promise<R2Object> {
  return bucket.put(key, stream, {
    httpMetadata: { contentType: content_type ?? "application/octet-stream" },
  });
}

/** 删除对象 */
export function del(bucket: R2Bucket, key: string): Promise<void> {
  return bucket.delete(key);
}

/** 构建公开桶的 302 重定向 URL */
export function public_url(domain: string, key: string): string {
  return `https://${domain}/${key}`;
}

/** 列表对象（用于校验等管理操作） */
export function list(bucket: R2Bucket, prefix?: string): Promise<R2Objects> {
  if (prefix) {
    return bucket.list({ prefix });
  }
  return bucket.list();
}
