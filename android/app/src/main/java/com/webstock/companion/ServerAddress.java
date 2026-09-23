package com.webstock.companion;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

final class ServerAddress {
    private ServerAddress() {}

    static String normalize(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("请输入 Windows 主机地址");
        boolean suppliedScheme = value.matches("^[A-Za-z][A-Za-z0-9+.-]*://.*$");
        if (!suppliedScheme) value = "http://" + value;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if (!("http".equals(scheme) || "https".equals(scheme))) {
                throw new IllegalArgumentException("只支持 HTTP 或 HTTPS 地址");
            }
            if (host.isEmpty() || uri.getUserInfo() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException("服务器地址格式无效");
            }
            String path = uri.getPath();
            if (path != null && !path.isEmpty() && !"/".equals(path)) {
                throw new IllegalArgumentException("请只输入主机和端口，不要带页面路径");
            }
            if (!isPrivateHost(host)) {
                throw new IllegalArgumentException("只允许连接局域网、本机或 Tailscale 私有地址");
            }
            int port = uri.getPort();
            if (port < -1 || port == 0 || port > 65535) throw new IllegalArgumentException("端口号无效");
            if (port == -1 && !suppliedScheme) port = 3000;
            String query = uri.getQuery();
            if (query != null && !query.matches("pair=[A-Fa-f0-9]{48,128}")) {
                throw new IllegalArgumentException("配对参数无效");
            }
            return scheme + "://" + host + (port == -1 ? "" : ":" + port) + "/" + (query == null ? "" : "?" + query);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("服务器地址格式无效");
        }
    }

    static String withoutPairingToken(String normalized) {
        try {
            URI uri = new URI(normalized);
            return new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), "/", null, null).toString();
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("服务器地址格式无效");
        }
    }

    static String pairingToken(String normalized) {
        try {
            String query = new URI(normalized).getQuery();
            return query != null && query.startsWith("pair=") ? query.substring(5) : "";
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("服务器地址格式无效");
        }
    }

    static String withPairingToken(String server, String token) {
        if (token == null || token.isEmpty()) return server;
        if (!token.matches("[A-Fa-f0-9]{48,128}")) throw new IllegalArgumentException("配对参数无效");
        return withoutPairingToken(server) + "?pair=" + token;
    }

    static boolean isPrivateHost(String host) {
        if (host == null || host.isEmpty()) return false;
        if ("localhost".equals(host) || host.endsWith(".local") || !host.contains(".")) return true;
        if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
        if (host.startsWith("100.")) {
            String[] parts = host.split("\\.");
            if (parts.length == 4) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 64 && second <= 127;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        if (host.startsWith("172.")) {
            String[] parts = host.split("\\.");
            if (parts.length == 4) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 16 && second <= 31;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        return false;
    }
}
