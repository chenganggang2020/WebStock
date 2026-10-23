package org.marketreview.nativeapp;
import android.content.*;
import android.view.View;
import android.widget.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import org.json.*;

final class SourceHandoffPanel extends LinearLayout {
  interface Opener{void open(String kind,JSONObject current) throws Exception;}
  interface Exporter{void write(String suggestedName,String mime,byte[] bytes) throws Exception;}
  interface Action{void run() throws Exception;}
  static JSONObject verifyExpected(BusinessStore business,String kind,JSONObject expected) throws Exception {
    SourceAnalysisPacket.require(kind.equals("collections")||kind.equals("docs"),"来源类型无效");
    JSONArray rows=business.read(kind);for(int i=0;i<rows.length();i++){JSONObject current=rows.getJSONObject(i);if(!current.optString("id").equals(expected.optString("id")))continue;
      SourceAnalysisPacket.require(SourceAnalysisPacket.canonical(current).equals(SourceAnalysisPacket.canonical(expected)),"来源已编辑或恢复；拒绝打开同ID新版本");return current;}
    throw new IllegalArgumentException("来源已删除；拒绝打开同ID新版本");
  }
  final BusinessStore business;final SourceHandoffStore store;final Opener opener;
  final TextView state;final EditText kind,prompt,result,raw,context,json,sourceKey;
  final LinearLayout records,sourceButtons;final Button previous,next,confirm,cancel;
  final EditText importPreview;JSONObject selected=new JSONObject(),pending=new JSONObject();int offset;
  Exporter exporter;Runnable chooseImport;boolean darkTheme;
  static void styleTree(android.view.View view,boolean dark) {
    int foreground=dark?0xffdbe5f3:0xff1f3048,background=dark?0xff121d2a:0xfff7f9fc,hint=dark?0xff9eb3cb:0xff526781;
    if(view instanceof TextView){((TextView)view).setTextColor(foreground);((TextView)view).setHintTextColor(hint);}
    if(view instanceof Button){int[][] states={new int[]{-android.R.attr.state_enabled},new int[]{}};
      view.setBackgroundTintList(new android.content.res.ColorStateList(states,new int[]{dark?0xff172230:0xfff2f4f6,dark?0xff26394f:0xffe9eef5}));
      ((Button)view).setTextColor(new android.content.res.ColorStateList(states,new int[]{dark?0xff8796a8:0xff8893a2,foreground}));
    }else if(view instanceof EditText)view.setBackgroundTintList(android.content.res.ColorStateList.valueOf(hint));
    else if(view instanceof Spinner){Spinner s=(Spinner)view;java.util.List<String> values=new java.util.ArrayList<>();android.widget.SpinnerAdapter old=s.getAdapter();if(old!=null)for(int i=0;i<old.getCount();i++)values.add(String.valueOf(old.getItem(i)));int selected=s.getSelectedItemPosition();
      ArrayAdapter<String> adapter=new ArrayAdapter<String>(view.getContext(),android.R.layout.simple_spinner_dropdown_item,values){
        public android.view.View getView(int p,android.view.View old,android.view.ViewGroup parent){android.view.View v=super.getView(p,old,parent);((TextView)v).setTextColor(foreground);v.setBackgroundColor(background);return v;}
        public android.view.View getDropDownView(int p,android.view.View old,android.view.ViewGroup parent){android.view.View v=super.getDropDownView(p,old,parent);((TextView)v).setTextColor(foreground);v.setBackgroundColor(background);return v;}};
      s.setAdapter(adapter);if(selected>=0)s.setSelection(selected);s.setBackgroundTintList(android.content.res.ColorStateList.valueOf(hint));
    }else if(view instanceof LinearLayout||view instanceof ScrollView)view.setBackgroundColor(background);
    if(view instanceof android.view.ViewGroup)for(int i=0;i<((android.view.ViewGroup)view).getChildCount();i++)styleTree(((android.view.ViewGroup)view).getChildAt(i),dark);
  }
  void setDarkTheme(boolean dark){darkTheme=dark;styleTree(this,dark);}
  static TextView text(Context c,String s){TextView t=new TextView(c);t.setText(s);t.setTextIsSelectable(true);return t;}
  static EditText input(Context c,String hint,String tag){EditText t=new EditText(c);t.setHint(hint);t.setTag(tag);t.setTextSize(13);return t;}
  static EditText readOnly(Context c,String tag){EditText t=input(c,"",tag);t.setKeyListener(null);t.setTextIsSelectable(true);t.setMinLines(3);return t;}
  static LinearLayout vertical(Context c){LinearLayout p=new LinearLayout(c);p.setOrientation(VERTICAL);return p;}
  void safe(Action action){try{action.run();}catch(Exception e){state.setText(e.getMessage());}}
  Button button(LinearLayout target,String title,Action action){Button b=new Button(getContext());b.setText(title);target.addView(b);b.setOnClickListener(v->safe(action));styleTree(b,darkTheme);return b;}
  SourceHandoffPanel(Context c,BusinessStore business,File file,Opener opener) throws Exception {
    super(c);this.business=business;this.store=new SourceHandoffStore(file);this.opener=opener;setOrientation(VERTICAL);
    ScrollView scroll=new ScrollView(c);addView(scroll,new LayoutParams(-1,-1));LinearLayout form=vertical(c);scroll.addView(form);
    state=text(c,"本机交接历史 · 手动回填待核验 · 不表示在线AI执行");state.setTag("sourceHandoffState");form.addView(state);
    kind=input(c,"类型筛选，空为全部：source-analysis / stock / general…","sourceHandoffKind");form.addView(kind);button(form,"重读历史",()->{offset=0;refresh();});
    records=vertical(c);form.addView(records);previous=button(form,"上一页",()->{offset=Math.max(0,offset-50);refresh();});next=button(form,"下一页",()->{offset+=50;refresh();});
    form.addView(text(c,"原提示词全文"));prompt=readOnly(c,"sourceHandoffPrompt");form.addView(prompt);
    form.addView(text(c,"结果全文"));result=readOnly(c,"sourceHandoffResult");form.addView(result);
    form.addView(text(c,"原回答全文"));raw=readOnly(c,"sourceHandoffRaw");form.addView(raw);
    form.addView(text(c,"完整来源快照 / 上下文"));context=readOnly(c,"sourceHandoffContext");form.addView(context);sourceButtons=vertical(c);form.addView(sourceButtons);
    button(form,"复制结果全文",()->{((ClipboardManager)c.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("本机交接结果",result.getText()));state.setText("已复制全文；未上传");});
    button(form,"导出当前交接JSON",()->{SourceAnalysisPacket.require(selected.has("id"),"请先选择交接记录");write("交接记录.json","application/json",new JSONObject().put("schema","source-handoff-v1").put("records",new JSONArray().put(store.detail(selected.getString("id")))).toString().getBytes(StandardCharsets.UTF_8));});
    button(form,"导出全部交接备份",()->write("交接历史备份.json","application/json",store.backup()));
    button(form,"选择旧交接JSON / 备份",()->{SourceAnalysisPacket.require(chooseImport!=null,"可在下方粘贴用户导出的JSON预览；文件选择待宿主接线");chooseImport.run();});
    sourceKey=input(c,"导入来源名称（同一旧文件请保持名称，避免重复身份）","sourceHandoffImportSource");sourceKey.setText("webstock_ai_handoff_results.json");form.addView(sourceKey);
    json=input(c,"粘贴旧交接JSON数组或source-handoff-v1备份","sourceHandoffImportJson");json.setMinLines(3);form.addView(json);button(form,"只读预览粘贴JSON",()->previewImport(json.getText().toString(),sourceKey.getText().toString()));
    importPreview=readOnly(c,"sourceHandoffImportPreview");form.addView(importPreview);importPreview.setVisibility(GONE);
    confirm=button(form,"确认合并（保留已有，冲突不覆盖）",()->{JSONObject report=store.merge(pending);clearPreview();offset=0;refresh();state.setText("合并完成："+report.toString());});
    cancel=button(form,"取消导入",()->{clearPreview();state.setText("已取消预览；历史未改");});confirm.setVisibility(GONE);cancel.setVisibility(GONE);refresh();
  }
  void setFileActions(Exporter exporter,Runnable chooseImport){this.exporter=exporter;this.chooseImport=chooseImport;}
  void write(String name,String mime,byte[] bytes) throws Exception {SourceAnalysisPacket.require(exporter!=null,"导出文件选择待宿主接线；可复制完整原文");exporter.write(name,mime,bytes);state.setText("已提交用户选档导出；文件写入结果由宿主显示");}
  void clearPreview(){pending=new JSONObject();importPreview.setText("");importPreview.setVisibility(GONE);confirm.setVisibility(GONE);cancel.setVisibility(GONE);}
  void previewImport(String json,String sourceKey) throws Exception {
    clearPreview();pending=store.previewImport(json,sourceKey);importPreview.setText(pending.toString(2));importPreview.setVisibility(VISIBLE);confirm.setVisibility(VISIBLE);cancel.setVisibility(VISIBLE);confirm.setEnabled(pending.getJSONArray("errors").length()==0);state.setText("只读预览；未写入历史。请核对新增、重复、冲突和错误后确认。");
  }
  void refresh() throws Exception {
    records.removeAllViews();selected=new JSONObject();for(EditText t:new EditText[]{prompt,result,raw,context})t.setText("");sourceButtons.removeAllViews();JSONArray rows=store.page(offset,kind.getText().toString().trim());
    for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);String id=r.getString("id");button(records,r.optString("title")+" · "+r.optString("kind")+" · "+r.optString("savedAt"),()->show(id));}
    previous.setEnabled(offset>0);next.setEnabled(rows.length()==50);state.setText("本机交接记录 "+(rows.length()==0?0:offset+1)+"–"+(offset+rows.length())+" · 完整原文保留");
  }
  void show(String id) throws Exception {
    selected=store.detail(id);prompt.setText(selected.optString("prompt"));result.setText(selected.optString("result"));raw.setText(selected.optString("rawResult",selected.optString("result")));
    JSONObject sourceContext=new JSONObject();for(String k:new String[]{"id","kind","savedAt","summary","context","provenance","sourceReferences"})if(selected.has(k))sourceContext.put(k,selected.get(k));context.setText(SourceAnalysisPacket.json(sourceContext));sourceButtons.removeAllViews();JSONArray refs=selected.getJSONArray("sourceReferences");
    for(int i=0;i<refs.length();i++){JSONObject ref=refs.getJSONObject(i);button(sourceButtons,"打开对应原版本："+ref.getJSONObject("snapshot").optString("title"),()->{JSONObject current=SourceAnalysisPacket.exactSource(ref,business.read(ref.getString("kind")));SourceAnalysisPacket.require(opener!=null,"宿主来源入口待接线；历史快照仍可查看");opener.open(ref.getString("kind"),current);});}
  }
}
