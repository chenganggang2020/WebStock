package com.webstock.companion;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/** Isolated SQLite fixtures only; never opens the user's default database. */
final class WatchColorsAudit {
    private interface Checked {void run() throws Exception;}
    private final JSONArray checks=new JSONArray();
    private void check(String name,Checked test) throws Exception {
        JSONObject row=new JSONObject().put("name",name);
        try{test.run();row.put("pass",true);}catch(Throwable error){row.put("pass",false).put("error",String.valueOf(error));}
        checks.put(row);
    }
    private static void require(boolean value){if(!value)throw new AssertionError("condition failed");}
    private static JSONObject json(String value) throws Exception{return new JSONObject(value);}
    JSONObject run(Context context) throws Exception {
        String name="watch-colors-qa-"+java.util.UUID.randomUUID()+".db";
        StandaloneStore store=new StandaloneStore(context,name);
        try {
            store.save("watch",json("{\"id\":\"a\",\"code\":\"000001\",\"group\":\"银行\"}"));
            store.save("watch",json("{\"id\":\"b\",\"code\":\"000002\",\"group\":\"银行\"}"));
            check("legacy-group-has-stable-id-without-deleting-records",()->{JSONObject g=store.state().getJSONArray("watchGroups").getJSONObject(0);require(!g.getString("id").isEmpty());require(store.state().getJSONArray("watchGroups").getJSONObject(0).getString("id").equals(g.getString("id")));require(store.read("watch").length()==2);});
            check("rename-keeps-group-id-color-and-all-members",()->{JSONObject g=store.state().getJSONArray("watchGroups").getJSONObject(0);String id=g.getString("id");store.save("watchGroups",g.put("name","金融").put("color","violet"));require(store.state().getJSONArray("watchGroups").getJSONObject(0).getString("id").equals(id));for(int i=0;i<2;i++)require(store.read("watch").getJSONObject(i).getString("group").equals("金融"));});
            check("duplicate-name-and-invalid-color-are-rejected",()->{try{store.save("watchGroups",json("{\"name\":\"金融\",\"color\":\"blue\"}"));throw new AssertionError("duplicate accepted");}catch(IllegalArgumentException expected){}try{store.save("watchGroups",json("{\"name\":\"bad\",\"color\":\"url(evil)\"}"));throw new AssertionError("invalid color accepted");}catch(IllegalArgumentException expected){}});
            check("stock-override-and-primary-group-persist",()->{String id=store.state().getJSONArray("watchGroups").getJSONObject(0).getString("id");store.save("watchStyles",json("{\"id\":\"sz000001\",\"color\":\"amber\"}").put("primaryGroupId",id));require(store.read("watchStyles").getJSONObject(0).getString("color").equals("amber"));});
            check("group-delete-with-members-is-blocked",()->{String id=store.state().getJSONArray("watchGroups").getJSONObject(0).getString("id");try{store.remove("watchGroups",id);throw new AssertionError("member group deleted");}catch(IllegalArgumentException expected){}});
            check("backup-includes-group-and-stock-color",()->{JSONObject b=store.backup();require(b.getJSONArray("watchGroups").getJSONObject(0).getString("color").equals("violet"));require(b.getJSONArray("watchStyles").getJSONObject(0).getString("color").equals("amber"));});
            check("old-backup-without-color-kinds-preserves-colors",()->{JSONObject b=store.backup();b.remove("watchGroups");b.remove("watchStyles");store.importBackup(b);require(store.read("watchStyles").getJSONObject(0).getString("color").equals("amber"));require(store.state().getJSONArray("watchGroups").getJSONObject(0).getString("color").equals("violet"));});
            check("new-backup-round-trip-and-reopen-preserve-colors",()->{String target=name+"-restore";StandaloneStore restored=new StandaloneStore(context,target);try{restored.importBackup(store.backup());restored.close();restored=new StandaloneStore(context,target);require(restored.read("watchStyles").getJSONObject(0).getString("color").equals("amber"));require(restored.state().getJSONArray("watchGroups").getJSONObject(0).getString("color").equals("violet"));require(restored.read("watch").length()==2);}finally{restored.close();context.deleteDatabase(target);}});
            check("invalid-import-rolls-back-group-edits",()->{JSONObject b=store.backup();String old=store.state().getJSONArray("watchGroups").toString();b.getJSONArray("watchGroups").getJSONObject(0).put("color","blue");b.getJSONArray("watchStyles").getJSONObject(0).put("color","bad");try{store.importBackup(b);throw new AssertionError("bad import accepted");}catch(IllegalArgumentException expected){}require(store.state().getJSONArray("watchGroups").toString().equals(old));});
            check("empty-group-remains-and-rename-collision-rolls-back",()->{store.save("watchGroups",json("{\"id\":\"empty\",\"name\":\"观察\",\"color\":\"blue\"}"));require(store.state().getJSONArray("watchGroups").length()==2);try{store.save("watchGroups",json("{\"id\":\"empty\",\"name\":\"金融\"}"));throw new AssertionError("collision accepted");}catch(IllegalArgumentException expected){}require(store.read("watch").length()==2);});
            check("styles-reject-unrelated-primary-group",()->{try{store.save("watchStyles",json("{\"id\":\"sz000001\",\"color\":\"inherit\",\"primaryGroupId\":\"empty\"}"));throw new AssertionError("unrelated group accepted");}catch(IllegalArgumentException expected){}});
            check("moving-stock-clears-obsolete-primary-and-keeps-backup-restorable",()->{store.save("watch",json("{\"id\":\"a\",\"code\":\"000001\",\"group\":\"观察\"}"));require(store.read("watchStyles").getJSONObject(0).optString("primaryGroupId").isEmpty());store.importBackup(store.backup());require(store.read("watchStyles").getJSONObject(0).getString("color").equals("amber"));});
            check("removing-primary-membership-retains-override-without-dangling-group",()->{store.save("watchStyles",json("{\"id\":\"sz000001\",\"color\":\"amber\",\"primaryGroupId\":\"empty\"}"));store.remove("watch","a");require(store.read("watchStyles").getJSONObject(0).optString("primaryGroupId").isEmpty());store.importBackup(store.backup());});
        } finally {store.close();context.deleteDatabase(name);}
        int passed=0;for(int i=0;i<checks.length();i++)if(checks.getJSONObject(i).getBoolean("pass"))passed++;
        return new JSONObject().put("checks",checks).put("pass",passed).put("total",checks.length());
    }
}
