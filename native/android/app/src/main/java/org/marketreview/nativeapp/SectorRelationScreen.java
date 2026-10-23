package org.marketreview.nativeapp;
import android.content.Context;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.io.File;
import java.util.ArrayList;
final class SectorRelationScreen extends LinearLayout {
 final SectorRelationStore store;final BusinessStore business;final String reportId;
 final LinearLayout review,rows,form,toolbar;final Spinner topics,history,graphRows;final TextView reader,status;final EditText note;final CheckBox consent;boolean compactToolbar;
 final ArrayList<String> topicIds=new ArrayList<>(),historyIds=new ArrayList<>(),graphIds=new ArrayList<>();
 final ArrayList<Spinner> decisions=new ArrayList<>();final ArrayList<ArrayList<String>> actions=new ArrayList<>();
 JSONObject pending=new JSONObject(),viewed=new JSONObject();long epoch;String selectedTopic="";LinearLayout graphPane;Runnable onBack;
 interface Work{void run()throws Exception;}
 SectorRelationScreen(Context context,String report,File research,File businessFile,BusinessStore business)throws Exception{
  super(context);setOrientation(VERTICAL);setTag("sectorRelationPage");this.business=business;reportId=report;store=new SectorRelationStore(research,businessFile);
  status=text("请明确选择已有产业主题，阅读关系差异及完整来源后复核。");status.setTag("sectorRelationStatus");addView(status);
  review=new LinearLayout(context);review.setOrientation(VERTICAL);addView(review,new LayoutParams(-1,0,1));
  topics=new Spinner(context);topics.setTag("sectorRelationTopic");ArrayList<String> labels=new ArrayList<>();labels.add("请选择已有产业主题");topicIds.add("");JSONArray ts=store.topics();for(int i=0;i<ts.length();i++){JSONObject t=ts.getJSONObject(i);topicIds.add(t.getString("id"));labels.add(t.getString("name")+" / "+t.getString("id"));}adapter(topics,labels);review.addView(topics);
  toolbar=new LinearLayout(context);toolbar.setOrientation(VERTICAL);review.addView(toolbar);LinearLayout top=new LinearLayout(context);toolbar.addView(top);LinearLayout more=new LinearLayout(context);toolbar.addView(more);
  ScrollView scroll=new ScrollView(context);review.addView(scroll,new LayoutParams(-1,0,1));LinearLayout body=new LinearLayout(context);body.setOrientation(VERTICAL);scroll.addView(body);form=new LinearLayout(context);form.setOrientation(VERTICAL);body.addView(form);review.removeView(topics);form.addView(topics);rows=new LinearLayout(context);rows.setOrientation(VERTICAL);form.addView(rows);reader=new TextView(getContext()){@Override public boolean onPreDraw(){return !isShown()||getWidth()<=0||super.onPreDraw();}};reader.setTextSize(14);reader.setBreakStrategy(android.text.Layout.BREAK_STRATEGY_SIMPLE);reader.setHyphenationFrequency(android.text.Layout.HYPHENATION_FREQUENCY_NONE);reader.setTag("sectorRelationOriginal");reader.setTextIsSelectable(true);body.addView(reader);reader.setVisibility(GONE);
  note=new EditText(context);note.setTag("sectorRelationNote");note.setHint("必填人工复核说明；仅针对原文关系，不证明证券身份或事实");note.setMaxLines(3);form.addView(note);
  consent=new CheckBox(context);consent.setTag("sectorRelationConsent");consent.setText("已逐条阅读并选择，确认追加所选关系及复核版本");form.addView(consent);
  history=new Spinner(context);history.setTag("sectorRelationHistory");form.addView(history);graphRows=new Spinner(context);graphRows.setTag("sectorRelationGraphRows");form.addView(graphRows);
  LinearLayout modes=new LinearLayout(context);toolbar.addView(modes);button(modes,"sectorRelationReviewTab","复核 / 版本",()->showOriginal(false));button(modes,"sectorRelationSourceTab","完整原件",()->showOriginal(true));
  button(top,"sectorRelationPreview","读取差异",()->{
   cancel();showOriginal(false);viewed=new JSONObject();graphIds.clear();adapter(graphRows,new ArrayList<>());String topic=topic();SectorAiModel.need(!topic.isEmpty(),"请明确选择已有产业主题");pending=store.preview(reportId,topic);reader.setText(SectorRelationReview.read(pending));JSONArray list=pending.getJSONArray("rows");
   for(int i=0;i<list.length();i++){JSONObject r=list.getJSONObject(i),p=r.getJSONObject("proposal");rows.addView(text(change(r.getString("change"))+"\n"+p.getString("companyName")+" / "+p.getString("product")+"\n"+p.getString("claim")+"\n引用："+p.getString("quote")));
    Spinner choice=new Spinner(context);ArrayList<String> values=new ArrayList<>(),names=new ArrayList<>();values.add("");names.add("请选择动作");values.add("skip");names.add("跳过");
    boolean blocked=false;JSONArray flags=r.getJSONArray("flags");for(int j=0;j<flags.length();j++)if("source-unmapped".equals(flags.getString(j)))blocked=true;
    if(!blocked){values.add("candidate");names.add("保留待核验 / 记录重复");}if(r.getBoolean("canVerify")){values.add("verify");names.add("原文关系人工核验");}adapter(choice,names);rows.addView(choice);decisions.add(choice);actions.add(values);choice.setOnItemSelectedListener(listener(()->consent.setChecked(false)));
   }refreshHistory();status.setText(list.length()==0?"该报告没有关系可复核；仍可阅读完整原件。":"逐条选择动作，阅读完整来源后明确确认。");
  });
  button(top,"sectorRelationSave","确认追加",()->{
   SectorAiModel.need(pending.length()>0&&consent.isChecked(),"请先预览、逐条选择并确认");JSONArray choices=new JSONArray();for(int i=0;i<decisions.size();i++)choices.put(actions.get(i).get(decisions.get(i).getSelectedItemPosition()));
   JSONObject version=SectorRelationReview.version(pending,choices,note.getText().toString(),java.time.Instant.now().toString());long ticket=epoch;store.save(version,()->epoch!=ticket||!live());cancel();readVersion(version);refreshHistory();status.setText("已追加复核版本，旧人工关系保持；可打开原有关系图与原文。");
  });
  button(top,"sectorRelationCancel","取消",()->{cancel();status.setText("本次保存资格已取消，历史及原关系保留。");});
  button(more,"sectorRelationReadHistory","阅读版本",()->{int i=history.getSelectedItemPosition();SectorAiModel.need(i>=0&&i<historyIds.size(),"请选择历史");JSONObject v=store.readVersion(historyIds.get(i));cancel();readVersion(v);scroll.fullScroll(View.FOCUS_UP);});
  button(more,"sectorRelationGraph","关系图 / 原文",()->openGraph());
  button(more,"sectorRelationBack","返回报告",()->{cancel();if(onBack!=null)onBack.run();});
  topics.setOnItemSelectedListener(listener(()->{String id=topic();if(id.equals(selectedTopic))return;selectedTopic=id;cancel();viewed=new JSONObject();reader.setText("");graphIds.clear();adapter(graphRows,new ArrayList<>());refreshHistory();}));
  note.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int n,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){consent.setChecked(false);}public void afterTextChanged(android.text.Editable e){}});
 }
 static String change(String key){switch(key){case "new":return "新关系";case "additional-evidence":return "已有关系的新证据";case "duplicate":return "完全重复，原人工关系保持";case "conflict":return "存在相反观点，仅可待复核";default:return "来源未入资料正文，不能写入关系";}}
 TextView text(String s){TextView t=new TextView(getContext());t.setText(s);t.setTextSize(14);return t;}
 void adapter(Spinner s,ArrayList<String> values){s.setAdapter(new ArrayAdapter<String>(getContext(),android.R.layout.simple_spinner_dropdown_item,values));}
 AdapterView.OnItemSelectedListener listener(Work work){return new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int at,long id){try{work.run();}catch(Exception e){status.setText(e.getMessage());}}};}
 void button(LinearLayout row,String tag,String label,Work action){Button b=new Button(getContext());b.setTag(tag);b.setText(label);row.addView(b,new LayoutParams(0,-2,1));b.setOnClickListener(v->{if(!live()||review.getVisibility()!=VISIBLE)return;try{action.run();}catch(Exception e){status.setText(e.getMessage());}});}
 boolean live(){return isShown()&&getWindowVisibility()==VISIBLE&&hasWindowFocus();}
 String topic(){int i=topics.getSelectedItemPosition();return i>=0&&i<topicIds.size()?topicIds.get(i):"";}
 void cancel(){epoch++;pending=new JSONObject();if(consent!=null)consent.setChecked(false);if(rows!=null)rows.removeAllViews();decisions.clear();actions.clear();}
 void refreshHistory()throws Exception{historyIds.clear();if(!topic().isEmpty())historyIds.addAll(store.versions(topic()));adapter(history,historyIds);}
 void showOriginal(boolean original){form.setVisibility(original?GONE:VISIBLE);reader.setVisibility(original?VISIBLE:GONE);}
 void readVersion(JSONObject v)throws Exception{showOriginal(true);viewed=v;reader.setText(SectorRelationReview.read(v.getJSONObject("preview"))+"\n复核版本完整原件：\n"+v.toString(2));graphIds.clear();ArrayList<String> labels=new ArrayList<>();JSONArray inserts=v.getJSONArray("inserts");for(int i=0;i<inserts.length();i++){JSONObject r=inserts.getJSONObject(i);graphIds.add(r.getString("id"));labels.add(r.getString("claim")+" / "+r.getString("id"));}JSONArray rows=v.getJSONObject("preview").getJSONArray("rows");for(int i=0;i<rows.length();i++){JSONArray old=rows.getJSONObject(i).getJSONArray("existingIds");for(int j=0;j<old.length();j++){String id=old.getString(j);if(!graphIds.contains(id)){graphIds.add(id);labels.add("既有关系 / "+id);}}}adapter(graphRows,labels);}
 void openGraph()throws Exception{
  int i=graphRows.getSelectedItemPosition();SectorAiModel.need(viewed.length()>0&&i>=0&&i<graphIds.size(),"先阅读已保存版本并选择其中关系");cancel();if(graphPane!=null)removeView(graphPane);graphPane=new LinearLayout(getContext());graphPane.setOrientation(VERTICAL);Button back=new Button(getContext());back.setText("返回复核版本");graphPane.addView(back);ResearchCompaniesScreen graph=new ResearchCompaniesScreen(getContext(),business);graphPane.addView(graph,new LayoutParams(-1,0,1));addView(graphPane,new LayoutParams(-1,0,1));review.setVisibility(GONE);back.setOnClickListener(v->{removeView(graphPane);graphPane=null;review.setVisibility(VISIBLE);});graph.openGraphRelation(viewed.getString("topicId"),graphIds.get(i));
 }
 @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){super.onSizeChanged(w,h,oldw,oldh);post(()->{
  if(!isAttachedToWindow()||getWidth()<=0||getHeight()<=0)return;
  float density=getResources().getDisplayMetrics().density;boolean next=getWidth()/density>=700&&getHeight()/density<500;
  if(next==compactToolbar)return;compactToolbar=next;toolbar.setOrientation(next?HORIZONTAL:VERTICAL);
  for(int i=0;i<toolbar.getChildCount();i++){LinearLayout row=(LinearLayout)toolbar.getChildAt(i);row.setLayoutParams(new LayoutParams(next?0:-1,-2,next?row.getChildCount():0));}
 });}
 @Override protected void onVisibilityChanged(View changed,int visibility){super.onVisibilityChanged(changed,visibility);if(decisions!=null&&!isShown())cancel();}
 @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(!focus&&decisions!=null)cancel();}
 @Override protected void onDetachedFromWindow(){cancel();super.onDetachedFromWindow();}
}
