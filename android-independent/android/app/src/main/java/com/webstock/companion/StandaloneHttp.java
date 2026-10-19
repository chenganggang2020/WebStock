package com.webstock.companion;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.URI;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

public final class StandaloneHttp {
    private StandaloneHttp() {}
    public static String request(String url,String referer,JSONObject body,String apiKey,Charset charset) throws Exception {
        return request(url,referer,body,apiKey,charset,0);
    }
    private static String request(String url,String referer,JSONObject body,String apiKey,Charset charset,int timeoutMs) throws Exception {
        URI uri=new URI(url);
        if(!"https".equals(uri.getScheme()) || uri.getHost()==null || uri.getRawUserInfo()!=null || uri.getFragment()!=null) throw new IllegalArgumentException("服务地址需为有效的 HTTPS 地址");
        HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();
        connection.setConnectTimeout(timeoutMs>0?timeoutMs:10000); connection.setReadTimeout(timeoutMs>0?timeoutMs:body==null?15000:90000); connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("User-Agent","Mozilla/5.0 WebStockAndroid/2.3.0");
        if(referer!=null) connection.setRequestProperty("Referer",referer);
        long started=System.nanoTime();
        try {
            if(body!=null) {
                connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
                if(apiKey!=null && !apiKey.isEmpty()) connection.setRequestProperty("Authorization","Bearer "+apiKey);
                try(java.io.OutputStream output=connection.getOutputStream()) {output.write(body.toString().getBytes(StandardCharsets.UTF_8));}
            }
            int status=connection.getResponseCode(); if(status<200 || status>=300) throw new java.io.IOException("数据服务返回 HTTP "+status);
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[8192]; int count;
                while((count=input.read(buffer))!=-1) { if(timeoutMs>0 && (System.nanoTime()-started)/1000000L>2L*timeoutMs) throw new java.net.SocketTimeoutException("数据服务读取超时"); if(output.size()+count>8*1024*1024) throw new java.io.IOException("数据响应超过大小限制"); output.write(buffer,0,count); }
                return output.toString(charset.name());
            }
        } finally {connection.disconnect();}
    }
    public static String get(String url,String referer,Charset charset) throws Exception { return request(url,referer,null,null,charset); }
    public static String get(String url,String referer,Charset charset,int timeoutMs) throws Exception {
        if(timeoutMs<1) throw new IllegalArgumentException("网络超时必须大于零");
        return request(url,referer,null,null,charset,timeoutMs);
    }
}

