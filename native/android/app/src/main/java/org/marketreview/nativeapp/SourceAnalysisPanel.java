package org.marketreview.nativeapp;
import android.content.*;
import android.text.*;
import android.widget.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

final class SourceAnalysisPanel extends LinearLayout {
  final BusinessStore business;final SourceHandoffStore store;final SourceHandoffPanel history;
  final LinearLayout form;final ScrollView scroll;final TextView state;final Spinner subject,purpose,mode;
  EditText limit,from,to,title,preview,answer,extracted;JSONObject packet=new JSONObject();String lastSaved="",draftRevision="";boolean loading=true;
  final List<String> subjects=new ArrayList<>();SourceHandoffPanel.Exporter exporter;
  static final String[] PURPOSES={"overview","timeline","sectors","risks"},MODES={"recent","date","all"};
  SourceAnalysisPanel(Context c,BusinessStore business,File file,SourceHandoffPanel.Opener opener) throws Exception {
    super(c);this.business=business;store=new SourceHandoffStore(file);setOrientation(VERTICAL);
    LinearLayout tabs=new LinearLayout(c);addView(tabs);Button analysis=new Button(c),records=new Button(c);analysis.setText("整理材料 / 回填");records.setText("本机交接历史");tabs.addView(analysis);tabs.addView(records);
    scroll=new ScrollView(c);addView(scroll,new LayoutParams(-1,0,1));form=SourceHandoffPanel.vertical(c);scroll.addView(form);history=new SourceHandoffPanel(c,business,file,opener);addView(history,new LayoutParams(-1,0,1));history.setVisibility(GONE);
    analysis.setOnClickListener(v->{history.setVisibility(GONE);scroll.setVisibility(VISIBLE);});records.setOnClickListener(v->safe(()->{history.refresh();scroll.setVisibility(GONE);history.setVisibility(VISIBLE);}));
    state=SourceHandoffPanel.text(c,"材料、复制、导出和手动回填均本地；不自动上传、调用AI或认证作者原话");state.setTag("sourceAnalysisState");form.addView(state);
    subjects.add("");JSONArray rows=business.read("collections");for(int i=0;i<rows.length();i++){String s=SourceAnalysisPacket.subject(rows.getJSONObject(i));if(!subjects.contains(s))subjects.add(s);}
    List<String> labels=new ArrayList<>(subjects);labels.set(0,"全部已保存作者");subject=spinner(c,labels.toArray(new String[0]),"sourceAnalysisSubject");
    purpose=spinner(c,new String[]{"核心观点与证据","观点时间线","行业股票线索","风险矛盾核查"},"sourceAnalysisPurpose");mode=spinner(c,new String[]{"最近","日期范围（北京时间）","全部"},"sourceAnalysisMode");
    limit=field(c,"最近条数1–1000","sourceAnalysisLimit");limit.setText("10");limit.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);from=field(c,"开始 YYYY-MM-DD","sourceAnalysisFrom");to=field(c,"结束 YYYY-MM-DD","sourceAnalysisTo");title=field(c,"本机交接记录标题","sourceAnalysisTitle");
    button("生成完整材料",()->{SourceAnalysisPacket.require(answer.getText().toString().trim().isEmpty(),"已有回填草稿；先保存或明确新建分析，再换材料");JSONObject options=new JSONObject().put("mode",MODES[mode.getSelectedItemPosition()]).put("purpose",PURPOSES[purpose.getSelectedItemPosition()]).put("limit",Integer.parseInt(limit.getText().toString())).put("from",from.getText().toString()).put("to",to.getText().toString());packet=SourceAnalysisPacket.build(subjects.get(subject.getSelectedItemPosition()),business.read("collections"),options);lastSaved="";preview.setText(packet.getString("markdown"));persist();state.setText("已冻结"+packet.getInt("itemCount")+"条完整来源材料；日期/目的变更后须重新生成。");});
    button("复制材料全文",()->{SourceAnalysisPacket.require(packet.length()>0,"请先生成材料");((android.content.ClipboardManager)c.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("完整来源材料",packet.getString("markdown")));state.setText("已复制完整材料；未上传、未调用AI");});
    button("导出材料 Markdown",()->{SourceAnalysisPacket.require(packet.length()>0,"请先生成材料");history.write("分析材料.md","text/markdown",packet.getString("markdown").getBytes(StandardCharsets.UTF_8));state.setText(history.state.getText());});
    button("新建分析（清当前草稿）",()->{loading=true;packet=new JSONObject();lastSaved="";answer.setText("");title.setText("");preview.setText("");extracted.setText("");loading=false;persist();state.setText("已明确新建分析；已保存历史保留");});
    form.addView(SourceHandoffPanel.text(c,"完整材料预览"));preview=SourceHandoffPanel.readOnly(c,"sourceAnalysisPreview");form.addView(preview);
    answer=field(c,"手动粘贴外部回答；保存仅写本机历史，不回写股票/组合","sourceAnalysisAnswer");answer.setMinLines(5);
    extracted=SourceHandoffPanel.readOnly(c,"sourceAnalysisExtracted");form.addView(extracted);
    button("预览结果块",()->{extracted.setText(SourceAnalysisPacket.extractResult(answer.getText().toString()).getString("text"));state.setText("只预览提取；原回答保留，尚未保存历史");});
    button("明确保存本机交接记录",()->{SourceAnalysisPacket.require(store.draft().optString("draftRevision").equals(draftRevision),"其他入口已更新共享草稿；请重读后明确保存");String signature=SourceAnalysisPacket.hash(packet.optString("markdown")+'\0'+title.getText().toString()+'\0'+answer.getText().toString());SourceAnalysisPacket.require(!signature.equals(lastSaved),"相同材料和回答已保存；历史未重复写入");JSONObject saved=store.saveResult(packet,title.getText().toString(),answer.getText().toString());lastSaved=signature;persist();state.setText("已保存本机交接记录（手动回填，待核验）："+saved.getString("id"));});
    button("重读共享草稿（取最新）",()->{restoreDraft();state.setText("已明确取最新共享草稿；其他入口新稿未被覆盖");});restoreDraft();
    TextWatcher watcher=new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){safe(()->persist());}public void afterTextChanged(Editable s){}};
    for(EditText e:new EditText[]{answer,title,limit,from,to})e.addTextChangedListener(watcher);
    for(Spinner s:new Spinner[]{subject,purpose,mode})s.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int pos,long id){safe(()->persist());}public void onNothingSelected(android.widget.AdapterView<?> p){}});
  }
  Spinner spinner(Context c,String[] values,String tag){Spinner s=new Spinner(c);s.setTag(tag);s.setAdapter(new ArrayAdapter<>(c,android.R.layout.simple_spinner_dropdown_item,values));form.addView(s);return s;}
  EditText field(Context c,String hint,String tag){EditText e=SourceHandoffPanel.input(c,hint,tag);form.addView(e);return e;}
  void button(String label,SourceHandoffPanel.Action action){Button b=new Button(getContext());b.setText(label);form.addView(b);b.setOnClickListener(v->safe(action));}
  void safe(SourceHandoffPanel.Action action){try{action.run();}catch(Exception e){state.setText(e.getMessage());}}
  void persist() throws Exception {if(loading)return;JSONObject draft=new JSONObject().put("packet",packet).put("answer",answer.getText().toString()).put("title",title.getText().toString()).put("lastSaved",lastSaved)
      .put("subject",subjects.get(subject.getSelectedItemPosition())).put("purpose",PURPOSES[purpose.getSelectedItemPosition()]).put("mode",MODES[mode.getSelectedItemPosition()]).put("from",from.getText().toString()).put("to",to.getText().toString());
    String count=limit.getText().toString();draft.put("limit",count.matches("[0-9]{1,4}")?Integer.parseInt(count):10);draftRevision=store.saveDraft(draft,draftRevision).getString("draftRevision");}
  void restoreDraft() throws Exception {
    JSONObject draft=store.draft();loading=true;packet=SourceAnalysisPacket.object(draft,"packet");lastSaved=draft.optString("lastSaved");draftRevision=draft.optString("draftRevision");title.setText(draft.optString("title"));answer.setText(draft.optString("answer"));preview.setText(packet.optString("markdown"));limit.setText(Integer.toString(draft.optInt("limit",10)));from.setText(draft.optString("from"));to.setText(draft.optString("to"));
    int selected=subjects.indexOf(draft.optString("subject"));if(selected>=0)subject.setSelection(selected);purpose.setSelection(Math.max(0,Arrays.asList(PURPOSES).indexOf(draft.optString("purpose","overview"))));mode.setSelection(Math.max(0,Arrays.asList(MODES).indexOf(draft.optString("mode","recent"))));loading=false;
  }
  void setFileActions(SourceHandoffPanel.Exporter exporter,Runnable chooseImport){this.exporter=exporter;history.setFileActions(exporter,chooseImport);}
  void setDarkTheme(boolean dark){boolean previous=loading;loading=true;SourceHandoffPanel.styleTree(this,dark);history.setDarkTheme(dark);loading=previous;}
  void previewImport(String json,String sourceKey) throws Exception {history.previewImport(json,sourceKey);scroll.setVisibility(GONE);history.setVisibility(VISIBLE);}
}
