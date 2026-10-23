package org.marketreview.nativeapp;

import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.security.*;
import java.time.*;
import java.util.*;
import org.json.*;

/** Independent, explicit-save observation repository. No source transport or scheduler. */
final class DarkObservation {
  interface Cancel {
    boolean cancelled();
  }
  static final long SINGLE = 16L * 1024 * 1024, DAY = 32L * 1024 * 1024, TOTAL = 128L * 1024 * 1024;
  static final String SCHEMA = "native-dark-stock-observations/v1";
  static void need(boolean ok, String reason) {
    if (!ok)
      throw new IllegalArgumentException(reason);
  }
  static void check(Cancel cancel) {
    need(!Thread.currentThread().isInterrupted() && (cancel == null || !cancel.cancelled()),
        "操作已取消；已提交历史保留");
  }
  static JSONObject obj(Object... values) throws Exception {
    JSONObject o = new JSONObject();
    for (int i = 0; i < values.length; i += 2) o.put((String) values[i], values[i + 1]);
    return o;
  }
  static String sha(byte[] bytes) throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }
  static String hex(byte[] digest) {
    StringBuilder b = new StringBuilder();
    for (byte x : digest) b.append(String.format(Locale.ROOT, "%02x", x & 255));
    return b.toString();
  }
  static void canonical(Object value, Appendable b, int depth) throws Exception {
    need(depth <= 32, "观察数据嵌套超限");
    if (value instanceof JSONObject) {
      JSONObject o = (JSONObject) value;
      List<String> keys = new ArrayList<>();
      Iterator<String> it = o.keys();
      while (it.hasNext()) keys.add(it.next());
      Collections.sort(keys);
      b.append('{');
      boolean first = true;
      for (String k : keys) {
        if (!first)
          b.append(',');
        first = false;
        canonical(k, b, depth + 1);
        b.append(':');
        canonical(o.get(k), b, depth + 1);
      }
      b.append('}');
    } else if (value instanceof JSONArray) {
      JSONArray a = (JSONArray) value;
      b.append('[');
      for (int i = 0; i < a.length(); i++) {
        if (i > 0)
          b.append(',');
        canonical(a.get(i), b, depth + 1);
      }
      b.append(']');
    } else if (value instanceof String) {
      b.append('"');
      String text = (String) value;
      for (int index = 0; index < text.length(); index++) {
        char ch = text.charAt(index);
        b.append("\\u");
        String hex = Integer.toHexString(ch);
        for (int i = hex.length(); i < 4; i++) b.append('0');
        b.append(hex);
      }
      b.append('"');
    } else if (value instanceof Number) {
      double n = ((Number) value).doubleValue();
      need(Double.isFinite(n), "非有限数值");
      b.append('@');
      String h = Long.toHexString(Double.doubleToLongBits(n == 0 ? 0 : n));
      for (int i = h.length(); i < 16; i++) b.append('0');
      b.append(h);
    } else
      b.append(value instanceof Boolean ? value.toString() : "null");
  }
  // The v1 canonical representation is entirely ASCII. Stream exactly those bytes.
  static final class DigestText implements Appendable {
    final MessageDigest digest = MessageDigest.getInstance("SHA-256");
    final byte[] buffer = new byte[8192];
    final Cancel cancel;
    int used;
    DigestText(Cancel cancel) throws Exception { this.cancel = cancel; check(cancel); }
    void flush() { check(cancel); digest.update(buffer, 0, used); used = 0; }
    public DigestText append(char value) {
      need(value <= 127, "摘要编码不是ASCII");
      buffer[used++] = (byte) value;
      if (used == buffer.length) flush();
      return this;
    }
    public DigestText append(CharSequence value) { return append(value, 0, value.length()); }
    public DigestText append(CharSequence value, int start, int end) {
      for (int i = start; i < end; i++) append(value.charAt(i));
      return this;
    }
    String finish() { flush(); return hex(digest.digest()); }
  }
  static String hash(Object value) throws Exception { return hash(value, null); }
  static String hash(Object value, Cancel cancel) throws Exception {
    DigestText out = new DigestText(cancel);
    canonical(value, out, 0);
    return out.finish();
  }
  static long time(String text) {
    need(text.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})"),
        "时刻需含日期与时区");
    return OffsetDateTime.parse(text).toInstant().toEpochMilli();
  }
  static void day(String value) {
    need(value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")
            && LocalDate.parse(value).toString().equals(value),
        "需指定真实交易日");
  }
  static JSONObject parse(byte[] bytes, long limit) throws Exception {
    need(bytes.length <= limit, "观察文件超限");
    String text = StandardCharsets.UTF_8.newDecoder()
                      .onMalformedInput(CodingErrorAction.REPORT)
                      .onUnmappableCharacter(CodingErrorAction.REPORT)
                      .decode(ByteBuffer.wrap(bytes))
                      .toString();
    JSONTokener t = new JSONTokener(text);
    Object value = t.nextValue();
    need(value instanceof JSONObject && t.nextClean() == 0, "观察文件JSON损坏");
    return (JSONObject) value;
  }
  static byte[] bytes(JSONObject value) {
    return value.toString().getBytes(StandardCharsets.UTF_8);
  }
  static boolean exists(Path p) {
    return Files.exists(p, LinkOption.NOFOLLOW_LINKS);
  }
  static byte[] readFile(Path path, long limit, Cancel cancel) throws Exception {
    check(cancel);
    need(Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && !Files.isSymbolicLink(path)
            && Files.size(path) <= limit,
        "文件缺失、外来链接或超限");
    try (InputStream in = Files.newInputStream(path);
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[65536];
      int count;
      while ((count = in.read(buffer)) != -1) {
        check(cancel);
        need(out.size() + count <= limit, "观察文件超过限额");
        out.write(buffer, 0, count);
      }
      return out.toByteArray();
    }
  }
  static final class Prepared {
    private final byte[] bytes;
    final String id, preparedAt;
    private final JSONObject summary;
    Prepared(byte[] bytes, String id, String preparedAt, JSONObject summary) {
      this.bytes = bytes;
      this.id = id;
      this.preparedAt = preparedAt;
      this.summary = summary;
    }
    JSONObject summary() throws Exception {
      return new JSONObject(summary.toString());
    }
  }
  static Prepared prepare(JSONObject input, String preparedAt, Cancel cancel) throws Exception {
    check(cancel);
    time(preparedAt);
    byte[] raw = bytes(input);
    need(raw.length <= SINGLE, "完整快照超过16MiB");
    JSONObject snapshot = parse(raw, SINGLE);
    DarkStock.validate(snapshot);
    String id = hash(snapshot, cancel);
    JSONArray rows = snapshot.getJSONArray("rows");
    int uncertain = 0;
    for (int i = 0; i < rows.length(); i++)
      if (!Boolean.TRUE.equals(rows.getJSONObject(i).opt("reconciled")))
        uncertain++;
    JSONObject summary = obj("id", id, "tradingDay", snapshot.get("tradingDay"), "scanStartedAt",
        snapshot.get("scanStartedAt"), "receivedAt", snapshot.get("receivedAt"), "rowCount",
        rows.length(), "uncertainRows", uncertain, "sourceTime", JSONObject.NULL,
        "paginationSnapshotConsistent", false, "preparedAt", preparedAt, "bytes", raw.length);
    check(cancel);
    return new Prepared(raw, id, preparedAt, summary);
  }
  static JSONObject verify(Prepared p, Cancel cancel) throws Exception {
    check(cancel);
    JSONObject s = parse(p.bytes, SINGLE);
    DarkStock.validate(s);
    need(hash(s, cancel).equals(p.id), "预览内容发生变化");
    time(p.preparedAt);
    return s;
  }
  static JSONObject envelope(JSONObject manifest) throws Exception {
    return obj("schema", SCHEMA, "checksum", hash(manifest), "manifest", manifest);
  }
  static final class Audit {
    boolean exists;
    JSONObject manifest = new JSONObject();
    String revision = "absent";
    long bytes;
    Map<String, Long> days = new HashMap<>();
  }
  interface Visit {
    void apply(JSONObject entry, JSONObject snapshot) throws Exception;
  }
  static boolean lockOK(Path lock, byte[] token, Cancel cancel) throws Exception {
    return token == null ? !exists(lock) : Arrays.equals(readFile(lock, 128, cancel), token);
  }
  static Audit audit(Path dir, Cancel cancel, Visit visit, byte[] ownLock) throws Exception {
    check(cancel);
    need(!Files.isSymbolicLink(dir)
            && (!exists(dir)
                || !Files
                    .readAttributes(dir, java.nio.file.attribute.BasicFileAttributes.class,
                        LinkOption.NOFOLLOW_LINKS)
                    .isOther()),
        "观察仓目录不能是外来链接");
    Path lock = Paths.get(dir.toString() + ".lock");
    need(lockOK(lock, ownLock, cancel), "观察仓正被使用或留有未确认锁；未自动删除");
    Audit a = new Audit();
    if (!exists(dir))
      return a;
    need(Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS), "目标不是独立观察仓目录");
    byte[] raw = readFile(dir.resolve("manifest.json"), 2 * 1024 * 1024, cancel);
    JSONObject outer = parse(raw, 2 * 1024 * 1024);
    need(SCHEMA.equals(outer.optString("schema")) && outer.optJSONObject("manifest") != null,
        "外来仓身份；原文件保留");
    a.manifest = outer.getJSONObject("manifest");
    need(hash(a.manifest).equals(outer.optString("checksum")), "观察清单校验失败");
    String storeId = a.manifest.optString("storeId");
    need(storeId.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")
            && !UUID.fromString(storeId).equals(new UUID(0, 0)),
        "观察仓身份无效");
    JSONArray entries = a.manifest.getJSONArray("entries");
    need(entries.length() <= 1000 && a.manifest.opt("revision") instanceof Number
            && a.manifest.getDouble("revision") == entries.length(),
        "清单版本或数量无效");
    Set<String> names = new HashSet<>(), ids = new HashSet<>();
    names.add("manifest.json");
    for (int i = 0; i < entries.length(); i++) {
      check(cancel);
      JSONObject e = entries.getJSONObject(i);
      String id = e.getString("id"), d = e.getString("tradingDay");
      day(d);
      time(e.getString("savedAt"));
      need(id.matches("[a-f0-9]{64}") && ids.add(id), "观察身份重复或无效");
      names.add(id + ".json");
      byte[] payload = readFile(dir.resolve(id + ".json"), SINGLE, cancel);
      need(e.opt("bytes") instanceof Number && e.getDouble("bytes") == payload.length
              && sha(payload).equals(e.optString("payloadSha256")),
          "观察内容字节校验失败");
      JSONObject s = parse(payload, SINGLE);
      DarkStock.validate(s);
      need(hash(s, cancel).equals(id) && d.equals(s.optString("tradingDay"))
              && hash(s.get("source"), cancel).equals(e.optString("sourceKey"))
              && e.getInt("rowCount") == s.getJSONArray("rows").length()
              && e.get("receivedAt").equals(s.get("receivedAt"))
              && e.get("scanStartedAt").equals(s.get("scanStartedAt")),
          "观察索引与内容不一致");
      a.bytes += payload.length;
      a.days.put(d, a.days.getOrDefault(d, 0L) + payload.length);
      need(a.bytes <= TOTAL && a.days.get(d) <= DAY, "观察仓超限；未裁剪历史");
      if (visit != null)
        visit.apply(e, s);
    }
    Set<String> actual = new HashSet<>();
    try (DirectoryStream<Path> files = Files.newDirectoryStream(dir)) {
      for (Path f : files) actual.add(f.getFileName().toString());
    }
    need(actual.equals(names), "仓内存在外来/未完成文件；原文件保留");
    need(Arrays.equals(raw, readFile(dir.resolve("manifest.json"), 2 * 1024 * 1024, cancel))
            && lockOK(lock, ownLock, cancel),
        "读取期间观察仓变化，请重读");
    a.exists = true;
    a.revision = hash(a.manifest);
    return a;
  }
  static void atomic(Path target, byte[] data) throws Exception {
    Path temp = target.resolveSibling(".manifest-" + UUID.randomUUID() + ".tmp");
    boolean created = false;
    try {
      Files.createFile(temp);
      created = true;
      try (FileOutputStream out = new FileOutputStream(temp.toFile())) {
        out.write(data);
        out.getFD().sync();
      }
      Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      created = false;
    } finally {
      if (created && Files.isRegularFile(temp, LinkOption.NOFOLLOW_LINKS)
          && Arrays.equals(Files.readAllBytes(temp), data))
        Files.delete(temp);
    }
  }
  static final class Lock implements AutoCloseable {
    final Path path;
    final byte[] token = UUID.randomUUID().toString().getBytes(StandardCharsets.US_ASCII);
    Lock(Path path) throws Exception {
      this.path = path;
      Files.write(path, token, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    }
    public void close() {
      try {
        if (Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
            && Arrays.equals(Files.readAllBytes(path), token))
          Files.delete(path);
      } catch (Exception ignored) {
      }
    }
  }
  static final class Store {
    final Path directory;
    Store(File directory) {
      this.directory = directory.toPath().toAbsolutePath().normalize();
    }
    JSONObject preview(Prepared p, Cancel cancel) throws Exception {
      JSONObject s = verify(p, cancel);
      Audit a = audit(directory, cancel, null, null);
      boolean duplicate = false;
      JSONArray entries = a.manifest.optJSONArray("entries");
      if (entries == null)
        entries = new JSONArray();
      for (int i = 0; i < entries.length(); i++)
        duplicate |= p.id.equals(entries.getJSONObject(i).getString("id"));
      need(duplicate || entries.length() < 1000, "已达1000条上限，未裁剪");
      need(duplicate
              || (a.bytes + p.bytes.length <= TOTAL
                  && a.days.getOrDefault(s.getString("tradingDay"), 0L) + p.bytes.length <= DAY),
          "观察仓容量不足；未裁剪旧历史");
      JSONObject result = p.summary();
      result.put("expectedRevision", a.revision)
          .put("duplicate", duplicate)
          .put("storedSnapshots", entries.length());
      return result;
    }
    JSONObject append(Prepared p, String expectedRevision, String savedAt, Cancel cancel)
        throws Exception {
      JSONObject s = verify(p, cancel);
      need(time(savedAt) >= time(p.preparedAt), "保存时钟早于预览");
      Audit a = audit(directory, cancel, null, null);
      need(a.revision.equals(expectedRevision), "观察仓已变化，请重新预览");
      JSONArray old = a.manifest.optJSONArray("entries");
      if (old == null)
        old = new JSONArray();
      for (int i = 0; i < old.length(); i++) {
        JSONObject e = old.getJSONObject(i);
        if (p.id.equals(e.getString("id")))
          return obj("status", "duplicate", "id", p.id, "savedAt", e.get("savedAt"), "revision",
              a.revision);
      }
      need(old.length() < 1000 && a.bytes + p.bytes.length <= TOTAL
              && a.days.getOrDefault(s.getString("tradingDay"), 0L) + p.bytes.length <= DAY,
          "容量不足；旧历史未裁剪");
      need(Files.isDirectory(directory.getParent()), "观察仓父目录不存在");
      check(cancel);
      try (Lock lock = new Lock(Paths.get(directory.toString() + ".lock"))) {
        a = audit(directory, cancel, null, lock.token);
        need(a.revision.equals(expectedRevision), "确认期间观察仓变化，请重新预览");
        if (!a.exists) {
          Files.createDirectory(directory);
          a.manifest = obj(
              "storeId", UUID.randomUUID().toString(), "revision", 0, "entries", new JSONArray());
          atomic(directory.resolve("manifest.json"), bytes(envelope(a.manifest)));
        }
        Path file = directory.resolve(p.id + ".json");
        boolean created = false, committed = false;
        int written = 0;
        try {
          check(cancel);
          Files.createFile(file);
          created = true;
          try (FileOutputStream out = new FileOutputStream(file.toFile())) {
            for (int at = 0; at < p.bytes.length; at += 65536) {
              check(cancel);
              int count = Math.min(65536, p.bytes.length - at);
              out.write(p.bytes, at, count);
              written += count;
            }
            out.getFD().sync();
          }
          check(cancel);
          JSONObject e = obj("id", p.id, "payloadSha256", sha(p.bytes), "bytes", p.bytes.length,
              "tradingDay", s.get("tradingDay"), "sourceKey", hash(s.get("source")),
              "scanStartedAt", s.get("scanStartedAt"), "receivedAt", s.get("receivedAt"),
              "rowCount", s.getJSONArray("rows").length(), "savedAt", savedAt);
          JSONArray entries = a.manifest.getJSONArray("entries");
          entries.put(e);
          a.manifest.put("revision", entries.length());
          check(cancel);
          atomic(directory.resolve("manifest.json"), bytes(envelope(a.manifest)));
          committed = true;
          return obj(
              "status", "saved", "id", p.id, "savedAt", savedAt, "revision", hash(a.manifest));
        } finally {
          if (created && !committed) {
            try {
              if (Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) && Files.size(file) <= SINGLE
                  && Arrays.equals(Files.readAllBytes(file), Arrays.copyOf(p.bytes, written)))
                Files.delete(file);
            } catch (Exception ignored) {
            }
          }
        }
      }
    }
    JSONObject read(String key, String tradingDay, Cancel cancel) throws Exception {
      day(tradingDay);
      need(key.matches("(sh|sz|bj)[0-9]{6}|unknown:[0-9]+:[0-9]{6}"), "需完整来源证券身份");
      List<JSONObject> points = new ArrayList<>();
      Set<String> dates = new TreeSet<>(Collections.reverseOrder());
      Audit a = audit(directory, cancel, (entry, s) -> {
        dates.add(s.getString("tradingDay"));
        if (!tradingDay.equals(s.getString("tradingDay")))
          return;
        JSONArray rows = s.getJSONArray("rows");
        for (int i = 0; i < rows.length(); i++) {
          check(cancel);
          JSONObject row = rows.getJSONObject(i);
          if (!key.equals(row.getString("key")))
            continue;
          points.add(obj("id", entry.get("id"), "tradingDay", tradingDay, "savedAt",
              entry.get("savedAt"), "source", s.get("source"), "sourceKey", entry.get("sourceKey"),
              "scanStartedAt", s.get("scanStartedAt"), "batchReceivedAt", s.get("receivedAt"),
              "paginationSnapshotConsistent", false, "row", row));
        }
      }, null);
      points.sort((x, y) -> {
        long at = time(x.optJSONObject("row").optString("receivedAt")),
             bt = time(y.optJSONObject("row").optString("receivedAt"));
        return at == bt ? x.optString("id").compareTo(y.optString("id")) : Long.compare(at, bt);
      });
      JSONArray result = new JSONArray(), days = new JSONArray();
      for (JSONObject p : points) result.put(p);
      for (String d : dates) days.put(d);
      return obj("schema", "native-dark-stock-observation-history/v1", "key", key, "tradingDay",
          tradingDay, "availableDates", days, "points", result, "revision", a.revision,
          "automaticTrading", false, "note",
          "原交易日榜单的本机接收观察；缺记录不是0，接收时刻不是行情事件时刻；多页非同步快照");
    }
  }
  static long money(JSONObject row, String key) throws Exception {
    Object value = row.opt(key);
    need(value instanceof String && ((String) value).matches("-?(0|[1-9][0-9]{0,17})"),
        "MISSING_AMOUNT");
    long n = Long.parseLong((String) value);
    need(n >= -900719925474099100L && n <= 900719925474099100L, "AMOUNT_INVALID");
    return n;
  }
  static JSONObject compare(JSONObject from, JSONObject to) throws Exception {
    JSONObject out = obj("status", "blocked", "darkNetChangeCents", JSONObject.NULL,
        "visibleNetChangeCents", JSONObject.NULL, "combinedNetChangeCents", JSONObject.NULL,
        "paginationSnapshotConsistent", false, "sourceTime", JSONObject.NULL);
    try {
      JSONObject a = from.optJSONObject("row"), b = to.optJSONObject("row");
      need(a != null && b != null && a.length() > 0 && b.length() > 0, "POINT_MISSING");
      for (String k : new String[] {"key", "code", "providerMarket", "venue"})
        need(a.has(k) && b.has(k) && a.get(k).equals(b.get(k)), "IDENTITY_MISMATCH");
      need(("SH".equals(a.optString("venue")) && a.optDouble("providerMarket", -1) == 1
               && a.optString("key").equals("sh" + a.optString("code")))
              || ("SZ".equals(a.optString("venue")) && a.optDouble("providerMarket", -1) == 0
                  && a.optString("key").equals("sz" + a.optString("code"))),
          "IDENTITY_UNVERIFIED");
      String d = from.getString("tradingDay");
      day(d);
      need(d.equals(to.optString("tradingDay")), "TRADING_DAY_MISMATCH");
      need(from.optJSONObject("source") != null && to.optJSONObject("source") != null
              && hash(from.get("source")).equals(hash(to.get("source")))
              && hash(from.get("source")).equals(from.optString("sourceKey"))
              && hash(to.get("source")).equals(to.optString("sourceKey")),
          "SOURCE_MISMATCH");
      long start = time(a.getString("receivedAt")), end = time(b.getString("receivedAt"));
      need(start < end, "RECEIPT_ORDER");
      need(Boolean.TRUE.equals(a.opt("reconciled")) && Boolean.TRUE.equals(b.opt("reconciled")),
          "QUALITY_UNVERIFIED");
      long[] av = new long[3], bv = new long[3];
      String[] keys = {"darkNetCents", "visibleNetCents", "combinedNetCents"};
      for (int i = 0; i < 3; i++) {
        av[i] = money(a, keys[i]);
        bv[i] = money(b, keys[i]);
      }
      need(av[0] + av[1] == av[2] && bv[0] + bv[1] == bv[2], "RECONCILIATION_FAILED");
      out.put("darkNetChangeCents", Long.toString(bv[0] - av[0]))
          .put("visibleNetChangeCents", Long.toString(bv[1] - av[1]))
          .put("combinedNetChangeCents", Long.toString(bv[2] - av[2]))
          .put("status", "compared")
          .put("reason", "两份已存同口径模型净额之差；不是逐笔资金")
          .put("fromAt", a.get("receivedAt"))
          .put("toAt", b.get("receivedAt"))
          .put("gapOverTenMinutes", end - start > 600000);
    } catch (Exception e) {
      out.put("reason", e.getMessage());
    }
    return out;
  }
}
