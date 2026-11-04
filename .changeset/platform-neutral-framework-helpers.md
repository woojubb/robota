---
'@robota-sdk/agent-core': minor
---

Add the lexical and byte helpers the platform-neutral framework needs, so a neutral package reaches for no `node:path`, `node:crypto`, `node:util` or `Buffer`.

- `dirnamePath`, `basenamePath` (with Node's suffix quirk), `relativePath`, `relativeSegments`, `separatorOf` and `isRootedPath` join `resolvePath`, `joinPath` and `isAbsolutePath`. The platform is read from the path text, a relative path needs an absolute starting point and throws without one, and two shares of one Windows server are two roots.
- `utf8Decode` decodes UTF-8 and keeps a leading byte-order mark, as `Buffer.toString('utf8')` does; `base64UrlDecode` reads text the way `Buffer.from(text, 'base64url')` does; `isJsonEqual` answers as `isDeepStrictEqual` does for JSON-shaped values.
- `IFileSystem` and `IFileSystemAsync` take a `TFileEncoding` (`'utf8' | 'utf-8'`) instead of Node's global `BufferEncoding`.
