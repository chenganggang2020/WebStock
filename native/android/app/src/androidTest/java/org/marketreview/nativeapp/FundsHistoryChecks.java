package org.marketreview.nativeapp;

import java.time.Instant;
import org.json.JSONArray;
import org.json.JSONObject;

/** Constructed contract fixtures only: no user records, network calls, or database writes. */
final class FundsHistoryChecks {
  private static final Instant NOW = Instant.parse("2026-10-11T08:00:00Z");
  interface CheckedAction { void run() throws Exception; }

  private static void rejects(FlowInstrumentation t, String message, CheckedAction action)
      throws Exception {
    boolean rejected = false;
    try { action.run(); }
    catch (IllegalArgumentException expected) { rejected = true; }
    t.check(rejected, message);
  }
  private static JSONObject oldPoint(String timestamp, Object amount) throws Exception {
    return new JSONObject().put("timestamp", timestamp)
        .put("sourceKey", "vendor-classified:Eastmoney").put("netAmount", amount)
        .put("inflowAmount", JSONObject.NULL).put("outflowAmount", JSONObject.NULL)
        .put("buckets", new JSONObject().put("smallNetAmount", JSONObject.NULL)
                           .put("mediumNetAmount", -2).put("largeNetAmount", 30)
                           .put("superLargeNetAmount", 70));
  }
  private static JSONArray points(JSONObject... values) {
    JSONArray out = new JSONArray();
    for (JSONObject value : values) out.put(value);
    return out;
  }
  private static JSONObject legacy(JSONArray points) throws Exception {
    return new JSONObject().put("schema", "webstock.capital-flow.v1")
        .put("availability", "available").put("scope", "stock").put("code", "000001")
        .put("name", "独立合成契约样本")
        .put("source", new JSONObject().put("sourceClass", "vendor-classified")
                           .put("provider", "Eastmoney").put("exchangeGroundTruth", false))
        .put("metricContract", new JSONObject().put("currency", "CNY"))
        .put("observation", new JSONObject()
                                .put("observedAt", points.getJSONObject(points.length() - 1).get("timestamp"))
                                .put("checkedAt", "2026-10-09T07:02:00Z").put("state", "fresh"))
        .put("points", points);
  }
  private static JSONObject minimal() throws Exception {
    return legacy(points(oldPoint("2026-10-09T01:31:00Z", 100),
                         oldPoint("2026-10-09T01:33:00Z", 130)));
  }
  private static JSONObject nativePoint(String time, Object amount) throws Exception {
    return nativePoint(time, amount, "vendor-classified:Eastmoney");
  }
  private static JSONObject nativePoint(String time, Object amount, String source) throws Exception {
    return new JSONObject().put("time", Instant.parse(time).toEpochMilli()).put("mainNet", amount)
        .put("valid", true).put("sourceKey", source);
  }
  private static JSONObject imported(JSONObject input) throws Exception {
    return MarketData.legacyCapital(input, "SZ:stock:000001", NOW);
  }

  static void run(FlowInstrumentation t) throws Exception {
    preservesWholeLegacyDocumentAndAmounts(t);
    neverFills239Or240Points(t);
    preservesMarketAndInstrumentType(t);
    rejectsInvalidLegacyContracts(t);
    derivesFromElapsedTradingMinutes(t);
    handlesLunchBoundary(t);
    resetsAcrossDayAndSource(t);
    keepsMissingMainUnknown(t);
    explainsSignsWithoutClaimingAccountIdentity(t);
  }

  private static void preservesWholeLegacyDocumentAndAmounts(FlowInstrumentation t) throws Exception {
    JSONObject input = minimal(), out = imported(input);
    JSONArray rows = out.getJSONArray("rows");
    t.check(rows.length() == 2, "legacy funds retain two observed points");
    JSONObject first = rows.getJSONObject(0);
    t.check(first.getDouble("mainNet") == 100 && first.isNull("smallNet")
            && first.getDouble("mediumNet") == -2 && first.getDouble("largeNet") == 30
            && first.getDouble("superNet") == 70,
        "legacy main and bucket CNY values retain their meaning and null state");
    t.check(rows.getJSONObject(1).getLong("time") == Instant.parse("2026-10-09T01:33:00Z").toEpochMilli(),
        "original source timestamp retained exactly");
    t.check(out.getString("amountUnit").equals("CNY"), "legacy import does not rescale yuan as cents");
    t.check(out.getJSONObject("rawLegacy").toString().equals(input.toString()),
        "complete legacy document including source and observation provenance retained");
    t.check(out.getBoolean("cached") && out.getBoolean("imported"), "history is labeled imported cache, not live");
    Instant source = Instant.parse(out.getString("asOf"));
    t.check(source.equals(Instant.parse("2026-10-09T01:33:00Z")), "asOf is last original source timestamp");
    t.check(source.isBefore(Instant.parse(out.getString("checkedAt"))), "import/download time differs from source observation");
  }

  private static void neverFills239Or240Points(FlowInstrumentation t) throws Exception {
    JSONArray original = new JSONArray();
    for (String start : new String[] {"2026-10-09T01:31:00Z", "2026-10-09T05:01:00Z"})
      for (int i = 0; i < 120; ++i)
        original.put(oldPoint(Instant.parse(start).plusSeconds(i * 60).toString(), original.length() * 10));
    t.check(imported(legacy(original)).getJSONArray("rows").length() == 240,
        "240 original observations remain 240, not a fabricated full session grid");
    original.remove(40);
    JSONArray partial = imported(legacy(original)).getJSONArray("rows");
    t.check(partial.length() == 239, "missing original observation remains absent instead of zero filled");
    boolean preserved = true;
    for (int i = 0; i < original.length(); ++i)
      preserved &= partial.getJSONObject(i).getLong("time")
              == Instant.parse(original.getJSONObject(i).getString("timestamp")).toEpochMilli()
          && partial.getJSONObject(i).getDouble("mainNet") == original.getJSONObject(i).getDouble("netAmount");
    t.check(preserved, "all 239 timestamps and amounts retain their original pairing");
  }

  private static void preservesMarketAndInstrumentType(FlowInstrumentation t) throws Exception {
    t.check(imported(minimal()).getJSONArray("rows").length() == 2, "bare old stock 000001 maps to Shenzhen stock");
    for (String id : new String[] {"SH:index:000001", "SH:stock:000001", "SZ:etf:000001", "SZ:stock:000002"})
      rejects(t, "legacy funds reject mismatched full identity " + id,
          () -> MarketData.legacyCapital(minimal(), id, NOW));
    JSONObject sh = minimal().put("code", "600000");
    t.check(MarketData.legacyCapital(sh, "SH:stock:600000", NOW).getJSONArray("rows").length() == 2,
        "old 600000 stock retains Shanghai market");
    rejects(t, "Shanghai legacy stock cannot import under Shenzhen identity",
        () -> MarketData.legacyCapital(sh, "SZ:stock:600000", NOW));
    JSONObject unsupported = minimal().put("code", "830001");
    rejects(t, "unsupported market must not be guessed as Shenzhen",
        () -> MarketData.legacyCapital(unsupported, "SZ:stock:830001", NOW));
  }

  private static void rejectsInvalidLegacyContracts(FlowInstrumentation t) throws Exception {
    for (String mutation : new String[] {"schema", "source-class", "provider", "currency",
             "availability", "scope", "code", "duplicate", "disordered", "cross-day", "future", "observation-mismatch"}) {
      JSONObject input = minimal();
      switch (mutation) {
        case "schema": input.put("schema", "unrelated/v1"); break;
        case "source-class": input.getJSONObject("source").put("sourceClass", "local-estimate"); break;
        case "provider": input.getJSONObject("source").put("provider", "UnverifiedOther"); break;
        case "currency": input.getJSONObject("metricContract").put("currency", "USD"); break;
        case "availability": input.put("availability", "unavailable"); break;
        case "scope": input.put("scope", "sector"); break;
        case "code": input.put("code", "600000"); break;
        case "duplicate": input.getJSONArray("points").put(1, input.getJSONArray("points").get(0)); break;
        case "disordered": {
          JSONArray before = input.getJSONArray("points");
          input.put("points", points(before.getJSONObject(1), before.getJSONObject(0))); break;
        }
        case "cross-day": input.getJSONArray("points").put(1, oldPoint("2026-10-10T01:33:00Z", 130)); break;
        case "future": input = legacy(points(oldPoint("2026-10-12T01:31:00Z", 100), oldPoint("2026-10-12T01:33:00Z", 130))); break;
        case "observation-mismatch": input.getJSONObject("observation").put("observedAt", "2026-10-09T01:32:00Z"); break;
        default: throw new AssertionError("Unknown test mutation");
      }
      final JSONObject rejectedInput = input;
      rejects(t, "legacy funding refuses " + mutation, () -> imported(rejectedInput));
    }
  }

  private static void derivesFromElapsedTradingMinutes(FlowInstrumentation t) throws Exception {
    JSONArray rows = MarketData.capitalKinematics(points(nativePoint("2026-10-09T01:30:00Z", 100),
        nativePoint("2026-10-09T01:32:00Z", 160), nativePoint("2026-10-09T01:35:00Z", 280)));
    t.check(rows.length() == 3, "kinematics preserve observation count");
    t.check(rows.getJSONObject(0).isNull("netFlowSpeed") && rows.getJSONObject(0).isNull("netFlowAcceleration"),
        "first observation has no invented speed or acceleration");
    t.check(rows.getJSONObject(1).getDouble("netFlowSpeed") == 30 && rows.getJSONObject(1).isNull("netFlowAcceleration"),
        "60 yuan in two minutes is 30 CNY/min with unknown first acceleration");
    t.check(rows.getJSONObject(2).getDouble("netFlowSpeed") == 40
            && Math.abs(rows.getJSONObject(2).getDouble("netFlowAcceleration") - 3.3333) < .0001,
        "actual three-minute elapsed time drives speed and acceleration");
  }

  private static void handlesLunchBoundary(FlowInstrumentation t) throws Exception {
    JSONArray rows = MarketData.capitalKinematics(points(nativePoint("2026-10-09T03:29:00Z", 100),
        nativePoint("2026-10-09T03:30:00Z", 110), nativePoint("2026-10-09T05:00:00Z", 150),
        nativePoint("2026-10-09T05:01:00Z", 170)));
    t.check(rows.getJSONObject(1).getDouble("netFlowSpeed") == 10, "pre-lunch one-minute difference remains valid");
    t.check(rows.getJSONObject(2).isNull("netFlowSpeed") && rows.getJSONObject(2).isNull("netFlowAcceleration"),
        "11:30 to 13:00 has zero trading elapsed time, not a 90-minute denominator");
    t.check(rows.getJSONObject(3).getDouble("netFlowSpeed") == 20 && rows.getJSONObject(3).isNull("netFlowAcceleration"),
        "13:01 resumes valid speed without invented acceleration across an unknown speed");
    JSONArray across = MarketData.capitalKinematics(points(nativePoint("2026-10-09T03:29:00Z", 100),
        nativePoint("2026-10-09T05:01:00Z", 140)));
    t.check(across.getJSONObject(1).getDouble("netFlowSpeed") == 20,
        "11:29 to 13:01 spans two trading minutes, not 92 wall-clock minutes");
  }

  private static void resetsAcrossDayAndSource(FlowInstrumentation t) throws Exception {
    JSONArray rows = MarketData.capitalKinematics(points(nativePoint("2026-10-09T06:59:00Z", 100),
        nativePoint("2026-10-09T07:00:00Z", 110), nativePoint("2026-10-12T01:30:00Z", 30),
        nativePoint("2026-10-12T01:31:00Z", 50), nativePoint("2026-10-12T01:32:00Z", 90, "other-source"),
        nativePoint("2026-10-12T01:33:00Z", 110, "other-source")));
    for (int i : new int[] {2, 4})
      t.check(rows.getJSONObject(i).isNull("netFlowSpeed") && rows.getJSONObject(i).isNull("netFlowAcceleration"),
          "day/source boundary resets both derivatives at point " + i);
    for (int i : new int[] {3, 5})
      t.check(rows.getJSONObject(i).getDouble("netFlowSpeed") == 20 && rows.getJSONObject(i).isNull("netFlowAcceleration"),
          "new day/source resumes speed with still-unknown acceleration at point " + i);
  }

  private static void keepsMissingMainUnknown(FlowInstrumentation t) throws Exception {
    JSONArray rows = MarketData.capitalKinematics(points(nativePoint("2026-10-09T01:30:00Z", 100),
        nativePoint("2026-10-09T01:31:00Z", JSONObject.NULL), nativePoint("2026-10-09T01:32:00Z", 130),
        nativePoint("2026-10-09T01:33:00Z", 140)));
    t.check(rows.getJSONObject(1).isNull("mainNet") && rows.getJSONObject(1).isNull("netFlowSpeed"),
        "missing main amount is not zero or fake outflow");
    t.check(rows.getJSONObject(2).isNull("netFlowSpeed"), "unknown previous amount prevents difference");
    t.check(rows.getJSONObject(3).getDouble("netFlowSpeed") == 10 && rows.getJSONObject(3).isNull("netFlowAcceleration"),
        "speed resumes only after two real consecutive amounts");
  }

  private static void explainsSignsWithoutClaimingAccountIdentity(FlowInstrumentation t) throws Exception {
    JSONArray rows = MarketData.capitalKinematics(points(nativePoint("2026-10-09T01:30:00Z", 100),
        nativePoint("2026-10-09T01:31:00Z", 120), nativePoint("2026-10-09T01:32:00Z", 110),
        nativePoint("2026-10-09T01:33:00Z", -50), nativePoint("2026-10-09T01:34:00Z", -20),
        nativePoint("2026-10-09T01:35:00Z", 0)));
    String[] states = {"unknown", "sustained-inflow", "inflow-giveback", "outflow-accelerating", "outflow-narrowing", "unknown"};
    for (int i = 0; i < states.length; ++i)
      t.check(rows.getJSONObject(i).getJSONObject("flowState").getString("code").equals(states[i]),
          "provider net and change signs classify state " + states[i]);
  }
}
