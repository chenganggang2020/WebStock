package com.webstock.companion;

import java.net.URI;

/** Keep disk/UI operations out of the network worker queue. */
final class StandaloneRequests {
    static boolean isLocal(String address) {
        try {
            URI uri = new URI(address);
            if (uri.isAbsolute() || uri.getHost() != null) return false;
            String path = uri.getPath();
            return "/state".equals(path) || "/record".equals(path) || "/settings".equals(path)
                || "/portfolio".equals(path) || "/backup".equals(path) || "/chart-cache".equals(path);
        } catch (Exception ignored) { return false; }
    }
}
