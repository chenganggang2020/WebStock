package com.webstock.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import org.junit.Test;

public class MobileSnapshotStoreTest {
    private static final String VALID = "{\"schema\":\"webstock.mobile-snapshot/v1\",\"generatedAt\":\"2026-08-13T01:30:00.000Z\",\"accounts\":[]}";

    @Test
    public void atomicallyStoresAndReadsAValidatedSnapshot() throws Exception {
        File directory = Files.createTempDirectory("webstock-mobile-store").toFile();
        try {
            MobileSnapshotStore.write(directory, VALID);
            assertEquals(VALID, MobileSnapshotStore.read(directory));
            assertFalse(new File(directory, MobileSnapshotStore.FILE_NAME + ".tmp").exists());
        } finally {
            deleteTree(directory);
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsUnknownSnapshotSchemas() throws Exception {
        File directory = Files.createTempDirectory("webstock-mobile-store-invalid").toFile();
        try {
            MobileSnapshotStore.write(directory, "{\"schema\":\"unknown\"}");
        } finally {
            deleteTree(directory);
        }
    }

    @Test
    public void rendererBuildsReadableCardsAndEscapesUntrustedText() {
        String json = "{\"schema\":\"webstock.mobile-snapshot/v1\",\"generatedAt\":\"2026-08-13T01:30:00.000Z\"," +
            "\"accounts\":[{\"name\":\"广发证券 <script>\",\"valuationStatus\":\"saved-snapshot\",\"observedAt\":\"2026-08-11\"," +
            "\"source\":{\"label\":\"同花顺截图\",\"stale\":true},\"summary\":{\"totalAssets\":88469,\"totalPnl\":514.06,\"todayPnl\":-2013}," +
            "\"positions\":[{\"code\":\"600584\",\"name\":\"长电科技\",\"quantity\":200,\"currentPrice\":77.45,\"unrealizedPnl\":3556.24,\"unrealizedPnlRate\":29.797,\"quoteStatus\":\"saved-snapshot\"}]}]," +
            "\"research\":{\"totals\":{\"observationCount\":381,\"videoCount\":361,\"transcriptCount\":352,\"archiveCount\":359},\"channels\":[]}}";

        String html = MobileSnapshotHtml.render(json, "Windows 主机暂时离线");

        assertTrue(html.contains("离线快照"));
        assertTrue(html.contains("长电科技"));
        assertTrue(html.contains("+3,556.24"));
        assertTrue(html.contains("-2,013.00"));
        assertTrue(html.contains("研究资料 381"));
        assertTrue(html.contains("&lt;script&gt;"));
        assertFalse(html.contains("广发证券 <script>"));
    }

    @Test
    public void requestBuildsTheProtectedReadOnlyEndpointAndUnwrapsData() {
        assertEquals("http://100.64.12.8:3000/api/mobile/snapshot",
            MobileSnapshotClient.endpoint("http://100.64.12.8:3000/"));
        assertEquals("webstock_lan_token=abcdef", MobileSnapshotClient.cookieHeader("abcdef"));
        String data = MobileSnapshotClient.unwrap("{\"success\":true,\"data\":" + VALID + "}");
        assertEquals(VALID, data);
    }

    @Test(expected = IllegalArgumentException.class)
    public void requestRejectsFailedApiResponses() {
        MobileSnapshotClient.unwrap("{\"success\":false,\"error\":\"not paired\"}");
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }
}
