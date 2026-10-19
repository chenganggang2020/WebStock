package org.marketreview.nativeapp;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Device-only subset of v48 checks. Uses real Android AtomicFile, no JVM shim or app ledger. */
public final class PaperMonitorRecoveryQuoteDeviceChecks {
  private static final String CUT = "2026-10-13T02:00:00.000Z";
  private static final String ID = "SH:stock:600000";
  private final File root;
  private final JSONArray passed = new JSONArray();

  private PaperMonitorRecoveryQuoteDeviceChecks(Context context) throws Exception {
    root = new File(context.getFilesDir(), "paper-v48-device-" + UUID.randomUUID());
    if (!root.mkdir()) throw new Exception("Cannot create isolated fixture directory: " + root);
  }

  /** Call from FlowInstrumentation's worker thread. Returns a JSON receipt or throws on failure. */
  public static String run(Context context) throws Exception {
    PaperMonitorRecoveryQuoteDeviceChecks checks = new PaperMonitorRecoveryQuoteDeviceChecks(context);
    try {
      return checks.execute();
    } catch (Exception e) {
      throw new Exception("Paper v48 device checks failed; fixtures retained at " + checks.root, e);
    }
  }

  private void check(boolean value, String message) throws Exception {
    if (!value) throw new Exception(message);
    passed.put(message);
  }

  private static String healthy(String kind) {
    if (kind.equals("history"))
      return "{\"schema\":\"native-paper-monitor-archive/v1\",\"revision\":0,\"records\":[]}";
    if (kind.equals("settings"))
      return "{\"schema\":\"native-paper-policy-settings/v1\",\"revision\":0,\"records\":[]}";
    return "{\"schema\":\"native-paper-monitor-draft/v1\",\"revision\":0,\"state\":{\"selectedAccount\":\"\",\"drafts\":{}}}";
  }

  private static void writeBase(File path, String text) throws Exception {
    AtomicFile atomic = new AtomicFile(path);
    FileOutputStream out = atomic.startWrite();
    try {
      out.write(text.getBytes(StandardCharsets.UTF_8));
      atomic.finishWrite(out);
    } catch (Exception e) {
      atomic.failWrite(out);
      throw e;
    }
    if (!Arrays.equals(Files.readAllBytes(path.toPath()), text.getBytes(StandardCharsets.UTF_8)))
      throw new Exception("Real AtomicFile fixture write failed: " + path);
  }

  private static Map<String, String> inventory(File directory) throws Exception {
    File[] files = directory.listFiles();
    if (files == null) throw new Exception("Fixture listing failed");
    Map<String, String> result = new TreeMap<>();
    for (File file : files) {
      if (!file.isFile()) throw new Exception("Unexpected fixture entry: " + file);
      result.put(file.getName(), Arrays.toString(
          MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath()))));
    }
    return result;
  }

  private static void readDomain(String kind, File directory) throws Exception {
    if (kind.equals("history")) {
      new PaperMonitorStore(new File(directory, "paper-monitor-history.json")).read();
    } else if (kind.equals("settings")) {
      new PaperPolicyStore(new File(directory, "paper-monitor-settings.json")).read();
    } else {
      new PaperMonitorFlow(new PaperMonitorFlow.Host() {
        public JSONObject read() { throw new AssertionError("Draft read must not call host"); }
        public String now() { throw new AssertionError("Draft read must not call clock"); }
      }, directory, directory);
    }
  }

  private File caseDirectory(String name) throws Exception {
    File directory = new File(root, name);
    if (!directory.mkdir()) throw new Exception("Fixture directory already exists: " + directory);
    return directory;
  }

  private void recovery(String kind, String suffix, boolean hasBase) throws Exception {
    String name = kind + suffix + (hasBase ? "-with-base" : "-without-base");
    File directory = caseDirectory(name);
    File path = new File(directory, "paper-monitor-" + kind + ".json");
    if (hasBase) writeBase(path, healthy(kind));
    Files.write(new File(path + suffix).toPath(), "FOREIGN RECOVERY CONTENT".getBytes(StandardCharsets.UTF_8),
        StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
    Map<String, String> before = inventory(directory);
    Exception failure = null;
    try { readDomain(kind, directory); } catch (Exception e) { failure = e; }
    check(inventory(directory).equals(before), name + ": all names and bytes retained");
    check(failure != null && failure.getMessage() != null && failure.getMessage().contains("恢复文件"),
        name + ": explicit recovery-file rejection");
  }

  private static JSONObject object(Object... values) throws Exception {
    JSONObject result = new JSONObject();
    for (int i = 0; i < values.length; i += 2) result.put((String) values[i], values[i + 1]);
    return result;
  }

  private static JSONObject fixture(String receipt) throws Exception {
    // Same source payload shape as v48 FocusedChecks, passed through the production quote parser.
    String[] fields = new String[32];
    Arrays.fill(fields, "0");
    fields[0] = "synthetic source fixture"; fields[1] = "10"; fields[2] = "10"; fields[3] = "10.5";
    fields[30] = "2026-10-13"; fields[31] = "09:59:30";
    JSONObject quote = MarketData.quotes("var hq_str_sh600000=\"" + String.join(",", fields) + "\";", receipt)
                           .getJSONObject("sh600000");
    JSONObject account = object("id", "paper-1", "name", "synthetic paper", "type", "paper", "status", "active",
        "cashBalance", 10000, "cashSource", "manual", "cashVerification", "unverified");
    JSONObject trade = object("id", "t1", "accountId", "paper-1", "instrumentId", ID, "date", "2026-10-12",
        "side", "buy", "quantity", 100, "price", 10, "fee", 5, "tax", 0);
    JSONObject host = object("schema", "native-paper-monitor-host-snapshot/v1",
        "accounts", new JSONArray().put(account), "trades", new JSONArray().put(trade),
        "instruments", new JSONArray().put(object("id", ID, "symbol", "sh600000", "quote", quote)),
        "readEvidence", object("accountsComplete", true, "tradesComplete", true, "coherent", true,
            "source", "constructed-full-local-snapshot", "capturedAt", CUT));
    JSONObject session = object("schema", "native-paper-session-evidence/v1", "date", "2026-10-13",
        "known", true, "open", true, "continuous", true, "source", "constructed-calendar-evidence",
        "evidenceId", "fixture-only", "checkedAt", CUT);
    JSONObject policy = object("schema", "native-paper-monitor-policy/v1", "accountId", "paper-1",
        "maxSingleWeight", .2, "source", "constructed-account-policy", "revision", "1");
    return object("host", host, "session", session, "policy", policy, "cut", CUT);
  }

  private static JSONObject adapt(JSONObject fixture) throws Exception {
    return PaperMonitorHostAdapter.adapt(fixture.getJSONObject("host"), "paper-1", fixture.getString("cut"),
        fixture.getJSONObject("session"), fixture.getJSONObject("policy"));
  }

  private void quoteCase(String receipt, boolean available, String gap) throws Exception {
    JSONObject fixture = fixture(receipt), original = new JSONObject(fixture.toString());
    JSONObject result = adapt(fixture);
    check("adapted".equals(result.getString("status")), "quote projection: " + receipt);
    JSONObject projected = result.getJSONObject("input").getJSONObject("quotes").getJSONObject(ID);
    check(projected.getString("availability").equals(available ? "available" : "unavailable"),
        "quote availability: " + receipt);
    check(PortfolioMirrorModel.equal(fixture, original)
        && PortfolioMirrorModel.equal(projected.getJSONObject("originalQuote"),
            original.getJSONObject("host").getJSONArray("instruments").getJSONObject(0).getJSONObject("quote")),
        "full source quote and input preserved: " + receipt);
    if (available) {
      check("2026-10-13T01:59:30.000Z".equals(projected.getString("observedAt")),
          "observedAt remains source trade clock: " + receipt);
    } else {
      check(gap.equals(projected.getString("gapCode")) && projected.isNull("price") && projected.isNull("observedAt"),
          "unavailable reason and null values: " + receipt);
    }
  }

  private String execute() throws Exception {
    for (String kind : new String[] {"history", "settings", "draft"}) {
      File healthyDirectory = caseDirectory(kind + "-healthy");
      writeBase(new File(healthyDirectory, "paper-monitor-" + kind + ".json"), healthy(kind));
      Map<String, String> before = inventory(healthyDirectory);
      readDomain(kind, healthyDirectory);
      check(inventory(healthyDirectory).equals(before), kind + ": healthy read succeeds without mutation");
      for (String suffix : new String[] {".bak", ".new"})
        for (boolean hasBase : new boolean[] {false, true}) recovery(kind, suffix, hasBase);
    }
    quoteCase("2026-10-13T01:59:32.123456Z", true, "");
    quoteCase("2026-10-13T01:59:32.123456789Z", true, "");
    quoteCase("2026-10-13T02:00:00.000000001Z", false, "QUOTE_AFTER_CUT");
    quoteCase("2026-10-13T01:59:32.123Z", true, "");
    quoteCase("2026-10-13T01:59:32.1234567890Z", false, "QUOTE_RECEIPT");
    JSONObject invalidCut = fixture("2026-10-13T01:59:32.123Z");
    invalidCut.put("cut", "2026-10-13T02:00:00.000000001Z");
    check("CUT_INVALID".equals(adapt(invalidCut).getJSONArray("issues").getJSONObject(0).getString("code")),
        "local cut contract remains milliseconds");
    return object("status", "PASS", "assertions", passed.length(), "checks", passed,
        "fixtureDirectory", root.getAbsolutePath(), "recoveryCases", 12, "quoteCases", 5,
        "runtime", "Android framework AtomicFile; no shim", "automaticTrading", false).toString();
  }
}
