package org.marketreview.nativeapp;

import java.io.*;
import java.net.URL;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.*;

/** Only imports a pinned data model; no executable/script imported from backups or user files. */
final class RecognitionAssets {
  static final String MODEL = "vosk-model-small-cn-0.22";
  static final String URL = "https://alphacephei.com/vosk/models/" + MODEL + ".zip";
  // Digest of the official HTTPS artifact retrieved on 2026-10-12, not a publisher signature.
  static final String SHA256 = "3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba";
  interface Input {
    InputStream open() throws Exception;
  }
  static String hex(byte[] hash) {
    StringBuilder s = new StringBuilder();
    for (byte b : hash) s.append(String.format(Locale.ROOT, "%02x", b & 255));
    return s.toString();
  }
  static JSONObject copy(InputStream input, File folder, long limit, String suffix)
      throws Exception {
    if (!folder.isDirectory() && !folder.mkdirs())
      throw new IOException("无法创建手机私有目录");
    File target = new File(folder, UUID.randomUUID() + suffix);
    boolean complete = false;
    try (FileOutputStream output = new FileOutputStream(target)) {
      MessageDigest hash = MessageDigest.getInstance("SHA-256");
      long size = 0;
      byte[] buffer = new byte[32768];
      int count;
      while ((count = input.read(buffer)) != -1) {
        DeviceRecognizer.interrupted();
        size += count;
        if (size > limit)
          throw new IOException("文件超过大小限制");
        output.write(buffer, 0, count);
        hash.update(buffer, 0, count);
      }
      DeviceRecognizer.interrupted();
      if (size == 0)
        throw new IOException("文件为空");
      output.getFD().sync();
      complete = true;
      return new JSONObject()
          .put("assetPath", target.getAbsolutePath())
          .put("sha256", hex(hash.digest()))
          .put("bytes", size)
          .put("deviceLocal", true);
    } finally {
      if (!complete)
        target.delete();
    }
  }
  static File install(InputStream input, File root) throws Exception {
    JSONObject zip = copy(input, root, 64L * 1024 * 1024, ".zip.part");
    File archive = new File(zip.getString("assetPath"));
    File extracted = new File(root, UUID.randomUUID().toString());
    boolean complete = false;
    try {
      if (!SHA256.equals(zip.getString("sha256")))
        throw new IOException("模型校验不符；仅支持官方中文small-cn-0.22压缩包");
      if (!extracted.mkdirs())
        throw new IOException("模型目录无法创建");
      long size = 0;
      int files = 0;
      String prefix = extracted.getCanonicalPath() + File.separator;
      try (ZipInputStream zin = new ZipInputStream(new FileInputStream(archive))) {
        ZipEntry entry;
        byte[] buffer = new byte[32768];
        while ((entry = zin.getNextEntry()) != null) {
          DeviceRecognizer.interrupted();
          if (++files > 1000)
            throw new IOException("模型文件过多");
          File out = new File(extracted, entry.getName());
          if (!out.getCanonicalPath().startsWith(prefix)
              || !entry.getName().startsWith(MODEL + "/"))
            throw new IOException("模型路径无效");
          if (entry.isDirectory()) {
            if (!out.isDirectory() && !out.mkdirs())
              throw new IOException("模型目录创建失败");
            continue;
          }
          if (!out.getParentFile().isDirectory() && !out.getParentFile().mkdirs())
            throw new IOException("模型子目录创建失败");
          try (FileOutputStream output = new FileOutputStream(out)) {
            int n;
            while ((n = zin.read(buffer)) != -1) {
              DeviceRecognizer.interrupted();
              size += n;
              if (size > 160L * 1024 * 1024)
                throw new IOException("模型解压超过限制");
              output.write(buffer, 0, n);
            }
            output.getFD().sync();
          }
        }
      }
      File model = new File(extracted, MODEL);
      for (String path : new String[] {"am/final.mdl", "conf/model.conf", "conf/mfcc.conf",
               "graph/HCLr.fst", "graph/Gr.fst"})
        if (!new File(model, path).isFile())
          throw new IOException("模型文件不完整");
      DeviceRecognizer.interrupted();
      complete = true;
      return model;
    } finally {
      archive.delete();
      if (!complete)
        removeTask(extracted, extracted);
    }
  }
  // Cleanup only our unique temporary import tree, never arbitrary user paths.
  static void removeTask(File item, File task) throws IOException {
    String root = task.getCanonicalPath(), path = item.getCanonicalPath();
    if (!path.equals(root) && !path.startsWith(root + File.separator))
      throw new IOException("清理路径越界");
    File[] children = item.listFiles();
    if (children != null)
      for (File child : children) removeTask(child, task);
    item.delete();
  }
  static File downloadModel(File root, DeviceRecognizer.Progress progress) throws Exception {
    HttpsURLConnection connection = (HttpsURLConnection) new URL(URL).openConnection();
    connection.setInstanceFollowRedirects(false);
    connection.setConnectTimeout(15000);
    connection.setReadTimeout(15000);
    try {
      if (connection.getResponseCode() != 200)
        throw new IOException("模型官方下载暂不可用；可用ZIP导入");
      progress.update("正在下载中文离线模型约42MB；仅此步骤需要网络");
      long begin = android.os.SystemClock.elapsedRealtime();
      try (InputStream input = new FilterInputStream(connection.getInputStream()) {
        public int read(byte[] buffer, int offset, int length) throws IOException {
          DeviceRecognizer.interrupted();
          if (android.os.SystemClock.elapsedRealtime() - begin > 15 * 60 * 1000)
            throw new IOException("模型下载超时");
          return super.read(buffer, offset, length);
        }
      }) {
        return install(input, root);
      }
    } finally {
      connection.disconnect();
    }
  }
}
