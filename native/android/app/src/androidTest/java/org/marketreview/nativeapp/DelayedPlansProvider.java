package org.marketreview.nativeapp;

/** Delayed synthetic document, compiled only into the instrumentation APK. */
public final class DelayedPlansProvider extends android.content.ContentProvider {
  public boolean onCreate() {
    return true;
  }
  public String getType(android.net.Uri u) {
    return "application/json";
  }
  public android.database.Cursor query(android.net.Uri u, String[] p, String s, String[] a, String o) {
    if(u.getPath().startsWith("/rotation-")){android.database.MatrixCursor c=new android.database.MatrixCursor(new String[]{android.provider.OpenableColumns.DISPLAY_NAME});c.addRow(new Object[]{u.getPath().equals("/rotation-day")?"rotation-day.json":"rotation-input.jsonl"});return c;}
    return null;
  }
  public android.net.Uri insert(android.net.Uri u, android.content.ContentValues v) {
    throw new UnsupportedOperationException();
  }
  public int delete(android.net.Uri u, String s, String[] a) {
    throw new UnsupportedOperationException();
  }
  public int update(android.net.Uri u, android.content.ContentValues v, String s, String[] a) {
    throw new UnsupportedOperationException();
  }
  public android.os.ParcelFileDescriptor openFile(android.net.Uri uri, String mode)
      throws java.io.FileNotFoundException {
    if("/etf-input".equals(uri.getPath())||"/etf-export".equals(uri.getPath())){boolean export=uri.getPath().equals("/etf-export");if(!export&&!mode.equals("r"))throw new java.io.FileNotFoundException("read only ETF archive");String id=uri.getQueryParameter("id");if(export&&(id==null||!id.matches("[a-f0-9-]{36}")))throw new java.io.FileNotFoundException("unique output required");return android.os.ParcelFileDescriptor.open(new java.io.File(getContext().getExternalFilesDir(null),export?"etf-export-"+id+".json":"etf-input.json"),export&&mode.equals("rw")?android.os.ParcelFileDescriptor.MODE_READ_WRITE|android.os.ParcelFileDescriptor.MODE_CREATE:android.os.ParcelFileDescriptor.parseMode(mode));}
    if("/rotation-oracle".equals(uri.getPath())){if(!mode.equals("r"))throw new java.io.FileNotFoundException("read only oracle");return android.os.ParcelFileDescriptor.open(new java.io.File(getContext().getExternalFilesDir(null),"rotation-oracle.json"),android.os.ParcelFileDescriptor.MODE_READ_ONLY);}
    if("/rotation-input".equals(uri.getPath())||"/rotation-day".equals(uri.getPath())||"/rotation-export".equals(uri.getPath())){
      String name=uri.getPath().equals("/rotation-day")?"rotation-day.json":uri.getPath().equals("/rotation-input")?"rotation-input.jsonl":"rotation-export.jsonl";
      if(uri.getPath().equals("/rotation-export")){String id=uri.getQueryParameter("id");if(id!=null&&id.matches("[a-f0-9-]{36}"))name="rotation-export-"+id+".jsonl";}
      if(!uri.getPath().equals("/rotation-export")&&!mode.equals("r"))throw new java.io.FileNotFoundException("read only real archive");
      return android.os.ParcelFileDescriptor.open(new java.io.File(getContext().getExternalFilesDir(null),name),android.os.ParcelFileDescriptor.parseMode(mode));
    }
    if("/history-export".equals(uri.getPath()))return android.os.ParcelFileDescriptor.open(new java.io.File(getContext().getCacheDir(),"history-export-fixture.json"),android.os.ParcelFileDescriptor.parseMode(mode));
    if (!mode.equals("r"))
      throw new java.io.FileNotFoundException("read only fixture");
    android.os.SystemClock.sleep(3000);
    try {
      android.os.ParcelFileDescriptor[] pipe = android.os.ParcelFileDescriptor.createPipe();
      new Thread(() -> {
        try (java.io.OutputStream out = new android.os.ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
          if("/history".equals(uri.getPath())){
            out.write(("{\"schema\":\"native-source-history-v1\",\"runs\":[{\"id\":\"legacy-webstock:sync-run:88889\",\"author\":\"测试文档提供者\",\"startedAt\":\"2026-10-10T08:00:00Z\",\"status\":\"completed\",\"counts\":{},\"items\":[]}]}").getBytes(java.nio.charset.StandardCharsets.UTF_8));return;
          }
          out.write(
              ("{\"schema\":\"native-android-source-plans-v1\",\"plans\":[{\"name\":\"延迟文件测试\","
               + "\"profileUrl\":\"https://www.douyin.com/user/"
               + "abcdefslow\",\"rightsBasis\":\"隔离验证\",\"limit\":1,\"intervalMinutes\":10}]}").getBytes(
                  java.nio.charset.StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
      }).start();
      return pipe[0];
    } catch (java.io.IOException e) {
      throw new java.io.FileNotFoundException(e.toString());
    }
  }
}
