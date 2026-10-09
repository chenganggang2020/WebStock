package com.webstock.companion;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.Arrays;
import java.util.UUID;

public final class StandaloneStore extends SQLiteOpenHelper {
    private static final String[] KINDS={"watch","accounts","trades","docs","reports","recent"};
    public StandaloneStore(Context context) { this(context,"webstock-independent.db"); }
    public StandaloneStore(Context context,String name) { super(context,name,null,1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(kind,id))");
        db.execSQL("CREATE TABLE cache(key TEXT PRIMARY KEY,payload TEXT NOT NULL,saved INTEGER NOT NULL)");
        ContentValues values=new ContentValues(); values.put("kind","accounts"); values.put("id","local");
        values.put("payload","{\"id\":\"local\",\"name\":\"我的账户\"}"); db.insertOrThrow("records",null,values);
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion) { throw new IllegalStateException("需要明确的数据迁移，禁止清空本机记录"); }
    private static void checkKind(String kind) { if(!Arrays.asList(KINDS).contains(kind)) throw new IllegalArgumentException("未知的本地记录类型"); }
    public synchronized JSONArray read(String kind) throws Exception {
        checkKind(kind); JSONArray result=new JSONArray();
        try(Cursor cursor=getReadableDatabase().query("records",new String[]{"payload"},"kind=?",new String[]{kind},null,null,"rowid ASC")) {
            while(cursor.moveToNext()) result.put(new JSONObject(cursor.getString(0)));
        }
        return result;
    }
    public synchronized JSONObject save(String kind,JSONObject supplied) throws Exception {
        return save(kind,supplied,true);
    }
    private JSONObject save(String kind,JSONObject supplied,boolean validateTrades) throws Exception {
        checkKind(kind); JSONObject item=new JSONObject(supplied.toString());
        String id=item.optString("id"); if(id.isEmpty()) id=UUID.randomUUID().toString();
        if(id.length()>100) throw new IllegalArgumentException("记录 ID 无效");
        item.put("id",id).put("updatedAt",Instant.now().toString());
        if(kind.equals("watch") || kind.equals("recent") || kind.equals("trades")) item.put("code",StandaloneCore.symbol(item.getString("code")).substring(2));
        if(kind.equals("accounts")) {
            String name=item.optString("name").trim(); if(name.isEmpty() || name.length()>100) throw new IllegalArgumentException("请填写账户名称"); item.put("name",name);
        }
        if(kind.equals("watch")) {
            String group=item.optString("group","默认分组").trim(); if(group.isEmpty() || group.length()>100) throw new IllegalArgumentException("分组名称无效"); item.put("group",group);
            JSONArray existing=read("watch");
            for(int i=0;i<existing.length();i++) { JSONObject row=existing.getJSONObject(i); if(!id.equals(row.getString("id")) && row.getString("code").equals(item.getString("code")) && row.optString("group").equals(group)) throw new IllegalArgumentException("该股票已在此分组"); }
        }
        if(kind.equals("docs") || kind.equals("reports")) {
            if(item.optString("title").trim().isEmpty()) throw new IllegalArgumentException("请填写资料标题");
            if(item.optString("text").length()>600000) throw new IllegalArgumentException("单篇资料过大，请拆分导入");
            String url=item.optString("sourceUrl"); if(!url.isEmpty() && !url.matches("https?://[^\\s]+")) throw new IllegalArgumentException("原文链接需为 HTTP 或 HTTPS");
            String verified=item.optString("verification","unverified");
            if(!verified.equals("unverified") && !verified.equals("manuallyVerified")) throw new IllegalArgumentException("核验状态无效");
            item.put("verification",verified);
        }
        SQLiteDatabase db=getWritableDatabase(); db.beginTransaction();
        try {
            ContentValues values=new ContentValues(); values.put("kind",kind); values.put("id",id); values.put("payload",item.toString());
            if(kind.equals("recent")) db.delete("records","kind=? AND id=?",new String[]{kind,id});
            if(db.update("records",values,"kind=? AND id=?",new String[]{kind,id})==0) db.insertOrThrow("records",null,values);
            if(kind.equals("trades") && validateTrades) validateLedger();
            if(kind.equals("recent")) db.execSQL("DELETE FROM records WHERE kind='recent' AND rowid NOT IN (SELECT rowid FROM records WHERE kind='recent' ORDER BY rowid DESC LIMIT 100)");
            db.setTransactionSuccessful(); return item;
        } finally {db.endTransaction();}
    }
    private void validateLedger() throws Exception {
        JSONArray trades=read("trades"),accounts=read("accounts"); java.util.HashSet<String> ids=new java.util.HashSet<>();
        for(int i=0;i<accounts.length();i++) ids.add(accounts.getJSONObject(i).getString("id"));
        for(int i=0;i<trades.length();i++) if(!ids.contains(trades.getJSONObject(i).optString("accountId"))) throw new IllegalArgumentException("交易所属账户不存在");
        for(String id:ids) StandaloneCore.ledger(trades,new JSONObject(),id);
    }
    public synchronized void remove(String kind,String id) throws Exception {
        checkKind(kind); SQLiteDatabase db=getWritableDatabase(); db.beginTransaction();
        try {
            if(kind.equals("accounts")) {
                if(id.equals("local")) throw new IllegalArgumentException("默认账户需保留");
                JSONArray trades=read("trades"); for(int i=0;i<trades.length();i++) if(id.equals(trades.getJSONObject(i).optString("accountId"))) throw new IllegalArgumentException("账户仍有交易记录，不能删除");
            }
            db.delete("records","kind=? AND id=?",new String[]{kind,id}); if(kind.equals("trades")) validateLedger();
            db.setTransactionSuccessful();
        } finally {db.endTransaction();}
    }
    public synchronized JSONObject cached(String key) throws Exception {
        try(Cursor cursor=getReadableDatabase().query("cache",new String[]{"payload"},"key=?",new String[]{key},null,null,null)) { return cursor.moveToFirst()?new JSONObject(cursor.getString(0)):null; }
    }
    public synchronized void cache(String key,JSONObject value) {
        ContentValues values=new ContentValues(); values.put("key",key); values.put("payload",value.toString()); values.put("saved",System.currentTimeMillis());
        getWritableDatabase().insertWithOnConflict("cache",null,values,SQLiteDatabase.CONFLICT_REPLACE);
        getWritableDatabase().execSQL("DELETE FROM cache WHERE key NOT IN (SELECT key FROM cache ORDER BY saved DESC LIMIT 400)");
    }
    public synchronized JSONObject quotes() throws Exception {
        JSONObject result=new JSONObject();
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT payload FROM cache WHERE key LIKE 'quote:%'",null)) {
            while(cursor.moveToNext()) {JSONObject row=new JSONObject(cursor.getString(0)); result.put(row.getString("symbol"),row);}
        }
        return result;
    }
    public synchronized JSONObject state() throws Exception {
        JSONObject result=new JSONObject(); for(String kind:KINDS) result.put(kind,read(kind));
        return result.put("quotes",quotes()).put("mode","independent").put("version","2.2.0");
    }
    public synchronized JSONObject backup() throws Exception {
        JSONObject result=new JSONObject().put("format","webstock-android-independent-v1").put("exportedAt",Instant.now().toString());
        for(String kind:KINDS) if(!kind.equals("recent")) result.put(kind,read(kind)); return result;
    }
    public synchronized void importBackup(JSONObject backup) throws Exception {
        if(!backup.optString("format").equals("webstock-android-independent-v1")) throw new IllegalArgumentException("备份格式不属于独立安卓版本");
        SQLiteDatabase db=getWritableDatabase(); db.beginTransaction();
        try {
            for(String kind:new String[]{"accounts","watch","docs","reports","trades"}) {
                JSONArray rows=backup.optJSONArray(kind); if(rows==null) continue;
                if(rows.length()>5000) throw new IllegalArgumentException("导入记录过多");
                for(int i=0;i<rows.length();i++) save(kind,rows.getJSONObject(i),false);
            }
            validateLedger(); db.setTransactionSuccessful();
        } finally {db.endTransaction();}
    }
}

