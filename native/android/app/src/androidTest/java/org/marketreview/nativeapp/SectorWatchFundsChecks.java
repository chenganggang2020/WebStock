package org.marketreview.nativeapp;

import java.nio.file.*;
import java.time.*;
import org.json.*;

/** Offline cross-platform validation of the single bounded public funds capture. */
public final class SectorWatchFundsChecks {
  public static void main(String[] args)throws Exception{
    Path publicFolder=Paths.get(args[0]),nativeFolder=Paths.get(args[1]);JSONArray receipts=new JSONArray(SectorWatchChecks.read(publicFolder.resolve("receipt.json")));JSONObject record=receipts.getJSONObject(1);
    JSONObject raw=new JSONObject(SectorWatchChecks.read(publicFolder.resolve("dark-stock-page1.raw")));
    JSONObject part=DarkStock.normalize(raw,"2026-10-12",1,record.getString("fetchedAt"));
    SectorWatchChecks.need(part.getJSONArray("rows").length()==100&&part.getJSONObject("coverage").getInt("totalReported")==5363,"Java accepts exact first source page");
    SectorWatchChecks.need(part.getJSONObject("quality").getInt("missingCoreRows")==0&&part.getJSONObject("quality").getInt("reconciliationFailures")==0,"source raw amount fields reconcile");
    DarkStock.Assembly a=new DarkStock.Assembly("2026-10-12",record.getString("startedAt"));SectorWatchChecks.need(!a.append(part,Duration.between(Instant.parse(record.getString("startedAt")),Instant.parse(record.getString("fetchedAt"))).toMillis()),"first page never becomes complete cache");
    SectorWatchChecks.rejected(a::finish);
    JSONObject full=new JSONObject(SectorWatchChecks.read(nativeFolder.resolve("full-snapshot.json")));DarkStock.validate(full);SectorWatchChecks.need(full.getJSONArray("rows").length()==5363&&full.getJSONObject("coverage").getInt("pages")==54&&!full.getJSONObject("coverage").getBoolean("paginationSnapshotConsistent"),"Qt complete source snapshot accepted by unchanged Java contract, no simultaneous snapshot claim");
    System.out.println("Funds offline Java/Qt contract GREEN checks="+SectorWatchChecks.checks+"; native Android HTTP NOT RUN");
  }
}
