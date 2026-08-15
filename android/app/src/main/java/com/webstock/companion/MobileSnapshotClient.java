package com.webstock.companion;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class MobileSnapshotClient {
    private MobileSnapshotClient() {}

    static String fetch(String serverUrl, String token) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint(serverUrl)).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(12_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Cookie", cookieHeader(token));
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String response = read(stream);
        connection.disconnect();
        if (status == 401) throw new SecurityException("配对信息已失效");
        if (status < 200 || status >= 300) throw new IOException("快照请求失败：HTTP " + status);
        return unwrap(response);
    }

    static String endpoint(String serverUrl) {
        return ServerAddress.withoutPairingToken(serverUrl) + "api/mobile/snapshot";
    }

    static String cookieHeader(String token) {
        return "webstock_lan_token=" + String.valueOf(token == null ? "" : token);
    }

    static String unwrap(String response) {
        try {
            JSONObject root = new JSONObject(response);
            JSONObject data = root.optJSONObject("data");
            if (!root.optBoolean("success") || data == null) {
                throw new IllegalArgumentException(root.optString("error", "移动快照响应无效"));
            }
            return data.toString();
        } catch (IllegalArgumentException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalArgumentException("移动快照响应不是有效 JSON");
        }
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            char[] buffer = new char[8_192];
            int count;
            while ((count = reader.read(buffer)) != -1) {
                result.append(buffer, 0, count);
                if (result.length() > MobileSnapshotStore.MAX_BYTES) throw new IOException("移动快照超过大小限制");
            }
        }
        return result.toString();
    }
}
