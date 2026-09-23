package com.webstock.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class ServerAddressTest {
    @Test
    public void addsHttpAndDefaultPortForBareLanAddress() {
        assertEquals("http://192.168.1.20:3000/", ServerAddress.normalize("192.168.1.20"));
    }

    @Test
    public void preservesExplicitSecureAddressAndPort() {
        assertEquals("https://webstock.local:8443/", ServerAddress.normalize("https://webstock.local:8443"));
    }

    @Test
    public void preservesAValidPairingToken() {
        String token = "a".repeat(64);
        assertEquals("http://192.168.1.20:3000/?pair=" + token,
            ServerAddress.normalize("http://192.168.1.20:3000/?pair=" + token));
        assertEquals("http://192.168.1.20:3000/",
            ServerAddress.withoutPairingToken("http://192.168.1.20:3000/?pair=" + token));
        assertEquals(token, ServerAddress.pairingToken("http://192.168.1.20:3000/?pair=" + token));
        assertEquals("http://192.168.1.20:3000/?pair=" + token,
            ServerAddress.withPairingToken("http://192.168.1.20:3000/", token));
    }

    @Test
    public void acceptsSharedLanAddressSpaceUsedByLocalNetworks() {
        assertEquals("http://100.64.213.144:3000/", ServerAddress.normalize("100.64.213.144"));
        assertThrows(IllegalArgumentException.class, () -> ServerAddress.normalize("100.128.0.1"));
    }

    @Test
    public void rejectsPublicHostsAndInjectedPaths() {
        assertThrows(IllegalArgumentException.class, () -> ServerAddress.normalize("https://example.com"));
        assertThrows(IllegalArgumentException.class, () -> ServerAddress.normalize("192.168.1.20/admin"));
        assertThrows(IllegalArgumentException.class, () -> ServerAddress.normalize("javascript:alert(1)"));
    }
}
