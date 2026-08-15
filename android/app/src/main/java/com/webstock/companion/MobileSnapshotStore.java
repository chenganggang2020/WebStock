package com.webstock.companion;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import org.json.JSONObject;

final class MobileSnapshotStore {
    static final String FILE_NAME = "mobile-snapshot-v1.json";
    static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final String SCHEMA = "webstock.mobile-snapshot/v1";

    private MobileSnapshotStore() {}

    static void write(File directory, String json) throws IOException {
        byte[] bytes = json == null ? new byte[0] : json.getBytes(StandardCharsets.UTF_8);
        if (bytes.length == 0 || bytes.length > MAX_BYTES) {
            throw new IllegalArgumentException("移动快照大小无效");
        }
        JSONObject root = parse(json);
        if (!SCHEMA.equals(root.optString("schema")) || root.optJSONArray("accounts") == null) {
            throw new IllegalArgumentException("移动快照格式无效");
        }
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("无法创建快照目录");
        File target = new File(directory, FILE_NAME);
        File temporary = new File(directory, FILE_NAME + ".tmp");
        Files.write(temporary.toPath(), bytes);
        try {
            Files.move(temporary.toPath(), target.toPath(),
                StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException error) {
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    static String read(File directory) {
        File target = new File(directory, FILE_NAME);
        try {
            byte[] bytes = Files.readAllBytes(target.toPath());
            if (bytes.length == 0 || bytes.length > MAX_BYTES) return "";
            String json = new String(bytes, StandardCharsets.UTF_8);
            JSONObject root = parse(json);
            return SCHEMA.equals(root.optString("schema")) && root.optJSONArray("accounts") != null ? json : "";
        } catch (Exception error) {
            return "";
        }
    }

    private static JSONObject parse(String json) {
        try {
            return new JSONObject(json);
        } catch (Exception error) {
            throw new IllegalArgumentException("移动快照不是有效 JSON");
        }
    }
}
