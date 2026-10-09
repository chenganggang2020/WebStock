package com.webstock.companion;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public final class StandaloneSecret {
    private static final String ALIAS="webstock_independent_ai";
    private final Context context;
    public StandaloneSecret(Context context) {this.context=context;}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if(!store.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build()); generator.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS,null);
    }
    public void save(String secret) throws Exception {
        if(secret.length()>4096 || secret.contains("\n") || secret.contains("\r")) throw new IllegalArgumentException("AI 密钥格式无效");
        if(secret.isEmpty()) {context.getSharedPreferences("independent-secrets",0).edit().remove("ai").apply();return;}
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key());
        JSONObject value=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)).put("cipher",Base64.encodeToString(cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
        context.getSharedPreferences("independent-secrets",0).edit().putString("ai",value.toString()).apply();
    }
    public String read() throws Exception {
        String stored=context.getSharedPreferences("independent-secrets",0).getString("ai",""); if(stored.isEmpty()) return "";
        JSONObject value=new JSONObject(stored); Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(value.getString("iv"),Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(value.getString("cipher"),Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    public boolean hasKey() {return context.getSharedPreferences("independent-secrets",0).contains("ai");}
}
