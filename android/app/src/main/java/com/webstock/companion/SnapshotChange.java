package com.webstock.companion;

import org.json.JSONArray;
import org.json.JSONObject;

final class SnapshotChange {
    final int newResearchCount;
    private final boolean accountChanged;
    private final boolean comparable;

    private SnapshotChange(int newResearchCount, boolean accountChanged, boolean comparable) {
        this.newResearchCount = newResearchCount;
        this.accountChanged = accountChanged;
        this.comparable = comparable;
    }

    static SnapshotChange between(String previousJson, String currentJson) {
        if (previousJson == null || previousJson.isEmpty() || currentJson == null || currentJson.isEmpty()) {
            return new SnapshotChange(0, false, false);
        }
        try {
            JSONObject previous = new JSONObject(previousJson);
            JSONObject current = new JSONObject(currentJson);
            int previousResearch = researchCount(previous);
            int currentResearch = researchCount(current);
            return new SnapshotChange(
                Math.max(0, currentResearch - previousResearch),
                accountsChangedMaterially(previous, current),
                true
            );
        } catch (Exception error) {
            return new SnapshotChange(0, false, false);
        }
    }

    boolean shouldNotify() {
        return comparable && (newResearchCount > 0 || accountChanged);
    }

    String message() {
        if (newResearchCount > 0) return "新增研究资料 " + newResearchCount + " 条，账户快照已刷新";
        return "账户快照已刷新，请打开 WebStock 查看";
    }

    private static int researchCount(JSONObject root) {
        JSONObject research = root.optJSONObject("research");
        JSONObject totals = research == null ? null : research.optJSONObject("totals");
        return totals == null ? 0 : totals.optInt("observationCount", 0);
    }

    private static boolean accountsChangedMaterially(JSONObject previous, JSONObject current) {
        JSONArray left = previous.optJSONArray("accounts");
        JSONArray right = current.optJSONArray("accounts");
        if (left == null || right == null || left.length() != right.length()) return true;
        for (int index = 0; index < left.length(); index += 1) {
            JSONObject previousAccount = left.optJSONObject(index);
            JSONObject currentAccount = right.optJSONObject(index);
            if (previousAccount == null || currentAccount == null ||
                previousAccount.optInt("id") != currentAccount.optInt("id")) return true;
            JSONObject previousSummary = previousAccount.optJSONObject("summary");
            JSONObject currentSummary = currentAccount.optJSONObject("summary");
            if (previousSummary == null || currentSummary == null ||
                previousSummary.optInt("positionCount") != currentSummary.optInt("positionCount")) return true;
            if (previousSummary.isNull("totalAssets") || currentSummary.isNull("totalAssets")) continue;
            double previousAssets = previousSummary.optDouble("totalAssets", Double.NaN);
            double currentAssets = currentSummary.optDouble("totalAssets", Double.NaN);
            if (Double.isFinite(previousAssets) && previousAssets > 0 && Double.isFinite(currentAssets) &&
                Math.abs(currentAssets - previousAssets) / previousAssets >= 0.03) return true;
        }
        return false;
    }
}
