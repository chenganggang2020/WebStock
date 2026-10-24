package org.marketreview.nativeapp;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.json.*;

/** Host-runnable checks; constructed XML is never presented as a live disclosure. */
public final class CffexPositionChecks {
  static int checks;
  static void check(boolean ok, String reason) { if (!ok) throw new AssertionError(reason); checks++; }
  static String row(String contract, int type, int rank, String party, String member, String amount, String change) {
    return "<data><tradingday>20261023</tradingday><productid>IF</productid><instrumentid>" + contract
        + "</instrumentid><datatypeid>" + type + "</datatypeid><rank>" + rank + "</rank><partyid>" + party
        + "</partyid><shortname>" + member + "</shortname><volume>" + amount + "</volume><varvolume>" + change + "</varvolume></data>";
  }
  static JSONObject report(String rows) throws Exception {
    JSONObject q = CffexDisclosureModel.request("2026-10-23", "IF");
    return CffexDisclosureModel.parse(("<root>" + rows + "</root>").getBytes(StandardCharsets.UTF_8), q,
        q.getString("url"), "2026-10-24T08:00:00Z", "fixture-constructed");
  }
  static JSONObject member(JSONObject summary, String key) throws Exception {
    JSONArray rows = summary.getJSONArray("members");
    for (int i = 0; i < rows.length(); i++) if (rows.getJSONObject(i).getString("memberKey").equals(key)) return rows.getJSONObject(i);
    throw new AssertionError("missing member " + key);
  }
  static JSONObject summary(JSONObject r) throws Exception { return CffexPositionSummary.contract(r.getJSONArray("contracts").getJSONObject(0)); }
  public static void main(String[] args) throws Exception {
    if(args.length>0&&args[0].equals("--movement-labels")){
      double[][] values={{-24559,1277},{-600,-300},{300,100},{300,-100},{-182,-640},{182,640},{0,0},{0,-300}};
      String[] expected={"净空减少 1277 手","净空增加 300 手","净多增加 100 手","净多减少 100 手","转为净空 · 净额 −640 手","转为净多 · 净额 +640 手","净持仓不变","多空转为持平 · 变动 300 手"};
      for(int i=0;i<values.length;i++)check(CffexPositionSummary.changeText(new JSONObject().put("net",values[i][0]).put("netChange",values[i][1])).equals(expected[i]),expected[i]);
      check(CffexPositionSummary.changeText(new JSONObject().put("net",10).put("netChange",JSONObject.NULL)).equals("净增减未知"),"missing change stays unknown");
      check(CffexPositionSummary.changeText(new JSONObject().put("net",JSONObject.NULL).put("netChange",100)).equals("净多方向增加 100 手"),"unknown position cannot claim long holding");
      System.out.println("PASS movement labels: "+checks);return;
    }
    JSONObject r = report(row("IF2611",1,1,"0018","中信期货(代客)","1200","70")
        + row("IF2611",2,1,"0018","中信期货(代客)","900","-30")
        + row("IF2611",1,2,"0020","其他期货","80","-10") + row("IF2611",2,2,"0020","其他期货","500","20")
        + row("IF2611",0,1,"0018","中信期货(代客)","999999","999999"));
    String original = r.toString();
    JSONObject s = summary(r), citic = s.getJSONObject("citic");
    check(citic.getDouble("net") == 300 && citic.getDouble("netChange") == 100, "net and change use both corresponding sides");
    check(member(s,"party:0020").getDouble("net") == -420 && member(s,"party:0020").getDouble("netChange") == -30, "other member net short and change");
    check(s.getJSONArray("members").length() == 2, "turnover rows must not enter positions");
    check(CffexPositionSummary.netText(citic).equals("净多 300 手"), "explicit long units");
    check(CffexPositionSummary.netText(member(s,"party:0020")).equals("净空 420 手"), "short shown as positive size");
    check(r.toString().equals(original) && CffexDisclosureModel.equal(r, CffexDisclosureModel.validate(r)), "derived display must not mutate strict report schema");

    r = report(row("IF2611",1,1,"0018","中信期货有限公司","1000","-100") + row("IF2611",2,1,"0018","中信期货有限公司","1600","200"));
    citic = summary(r).getJSONObject("citic");
    check(citic.getDouble("net") == -600 && citic.getDouble("netChange") == -300, "negative change is long change minus short change");
    r = report(row("IF2611",1,1,"0018","中信期货","1000","50")
        + row("IF2611",1,2,"0020","其他期货","100","10") + row("IF2611",2,1,"0020","其他期货","500","20"));
    citic = summary(r).getJSONObject("citic");
    check(citic.isNull("short") && citic.isNull("net") && citic.isNull("netChange"), "missing short side remains unknown");
    r = report(row("IF2611",1,1,"0018","中信期货(代客)","1000","50")
        + row("IF2611",2,1,"0099","中信期货(代客)","900","-10")
        + row("IF2611",1,2,"0115","中信建投期货","6000","600") + row("IF2611",2,2,"0115","中信建投期货","2000","100"));
    s = summary(r);
    check(s.getJSONObject("citic").isNull("net"), "different member keys cannot be paired by name");
    check(member(s,"party:0018").isNull("net") && member(s,"party:0099").isNull("net"), "one-sided rows stay unknown");
    check(member(s,"party:0115").getDouble("net") == 4000 && !member(s,"party:0115").getBoolean("citic"), "Citic Construction must not become Citic Futures");
    r = report(row("IF2611",1,1,"0018","中信期货（自营）","0","0") + row("IF2611",2,1,"0018","中信期货（自营）","0","0")
        + row("IF2611",1,2,"0020","其他期货","10","--") + row("IF2611",2,2,"0020","其他期货","10","1"));
    s = summary(r);
    check(s.getJSONObject("citic").getDouble("net") == 0 && s.getJSONObject("citic").getDouble("netChange") == 0, "disclosed zero remains numeric");
    check(member(s,"party:0020").isNull("netChange"), "missing change is not zero");
    r = report(row("IF2611",1,1,"","中信期货","100","5") + row("IF2611",2,1,"","中信期货","80","3"));
    check(summary(r).getJSONObject("citic").getDouble("net") == 20, "exact name fallback memberKey may pair");
    r = report(row("IF2611",1,1,"0018","中信期货","100","5") + row("IF2611",2,1,"0018","中信建投期货","80","3"));
    check(summary(r).getJSONObject("citic").isNull("net"), "conflicting Citic identity excluded from focus summary");
    check(member(summary(r),"party:0018").isNull("net") && member(summary(r),"party:0018").isNull("netChange"), "conflicting member names cannot produce a Citic member-row net");

    r = report(row("IF2611",1,1,"0018","中信期货","100","5") + row("IF2611",2,1,"0018","中信期货","80","3")
        + row("IF2612",1,1,"0018","中信期货","200","--") + row("IF2612",2,1,"0018","中信期货","300","2")
        + row("IF2703",1,1,"0018","中信期货","1000","10")
        + row("IF2706",1,1,"0115","中信建投期货","9000","90") + row("IF2706",2,1,"0115","中信建投期货","1000","10"));
    JSONObject total = CffexPositionSummary.citicTotal(r);
    check(total.getInt("covered") == 2 && total.getInt("total") == 4 && total.getDouble("net") == -80, "sum all comparable contracts with explicit coverage");
    check(total.isNull("netChange") && total.getInt("changeCovered") == 1, "partial change coverage cannot become full sum");
    JSONObject none = CffexPositionSummary.citicTotal(report(row("IF2611",1,1,"0018","中信期货","1000","10")));
    check(none.getInt("covered") == 0 && none.isNull("net") && none.isNull("netChange"), "zero comparable contracts means unknown");
    JSONObject large=report(row("IF2611",1,1,"0018","中信期货","9007199254740000","9007199254740000")
        + row("IF2611",2,1,"0018","中信期货","0","-9007199254740000"));
    JSONObject largeMember=summary(large).getJSONObject("citic");
    check(largeMember.getDouble("net")==9007199254740000d && largeMember.isNull("netChange"), "safe boundary remains numeric but oversized difference becomes unknown");
    JSONObject largeSum=CffexPositionSummary.citicTotal(report(row("IF2611",1,1,"0018","中信期货","9007199254740000","0")
        + row("IF2611",2,1,"0018","中信期货","0","0") + row("IF2612",1,1,"0018","中信期货","9007199254740000","0")
        + row("IF2612",2,1,"0018","中信期货","0","0")));
    check(largeSum.isNull("long") && largeSum.isNull("net") && largeSum.getInt("covered")==2, "oversized derived sums become unknown without losing coverage");

    CffexDisclosureUpdates updates = new CffexDisclosureUpdates();
    check(!updates.accept(r), "constructed response cannot alert");
    JSONObject live = new JSONObject(r.toString()).put("origin", "host-fetch-response");
    check(updates.accept(live), "first validated live response may alert");
    check(!updates.accept(new JSONObject(live.toString()).put("checkedAt", "2026-10-24T09:00:00Z")), "same original with new receipt time does not alert");
    CffexDisclosureUpdates restored = new CffexDisclosureUpdates();
    restored.restore(updates.saved());
    check(!restored.accept(live), "restored reading deduplicates same original");
    JSONObject revision = new JSONObject(live.toString()).put("rawSha256", "a".repeat(64));
    check(restored.accept(revision) && !restored.accept(live), "new raw revision alerts once; revisiting old original does not");
    JSONObject nextDay = new JSONObject(revision.toString()); nextDay.getJSONObject("request").put("date", "2026-10-26");
    check(restored.accept(nextDay), "trading date is part of alert identity");
    JSONObject nextProduct = new JSONObject(nextDay.toString()); nextProduct.getJSONObject("request").put("product", "IH");
    check(restored.accept(nextProduct), "product is part of alert identity");
    CffexDisclosureUpdates fromHistory = new CffexDisclosureUpdates(); fromHistory.remember(live);
    check(!fromHistory.accept(live), "history loading only seeds identity and never alerts");
    CffexDisclosureUpdates muted=new CffexDisclosureUpdates();muted.enabled=false;
    check(!muted.accept(live), "disabled notifications stay quiet on successful response");
    muted.enabled=true;
    check(!muted.accept(live) && muted.accept(revision), "re-enabling must not replay originals seen while muted");

    if (args.length > 0) {
      byte[] raw = Files.readAllBytes(Paths.get(args[0]));
      check(CffexDisclosureModel.hash(raw).equals("13ecebe8d0fb3b9ff7a0decf999aa7f24a9c7d5b71da239fd3d60bd7c8ad6842"), "captured source identity");
      JSONObject q = CffexDisclosureModel.request("2026-10-23", "IF");
      JSONObject actual = CffexDisclosureModel.parse(raw,q,q.getString("url"),"2026-10-24T08:00:00Z","import-unverified");
      double[][] expected = {{-182,-640},{-13629,1717},{-9214,440},{-1534,-240}};
      check(actual.getJSONArray("contracts").length() == 4, "captured four contracts");
      for(int i=0;i<4;i++) { JSONObject m=CffexPositionSummary.contract(actual.getJSONArray("contracts").getJSONObject(i)).getJSONObject("citic");
        check(m.getDouble("net")==expected[i][0] && m.getDouble("netChange")==expected[i][1], "captured contract " + i); }
      JSONObject aggregate=CffexPositionSummary.citicTotal(actual);
      check(aggregate.getInt("covered")==4 && aggregate.getInt("total")==4 && aggregate.getDouble("net")==-24559 && aggregate.getDouble("netChange")==1277, "captured all comparable Citic contracts");
      check(CffexDisclosureModel.equal(actual,CffexDisclosureModel.validate(actual)), "captured report stays valid after display calculation");
    }
    System.out.println("PASS " + checks + " CFFEX position and update checks; capturedSource=" + (args.length > 0));
  }
}
