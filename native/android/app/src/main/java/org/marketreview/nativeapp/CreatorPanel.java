package org.marketreview.nativeapp;
import android.graphics.*;
import android.os.Bundle;
import android.text.*;
import android.text.style.BackgroundColorSpan;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Native author relationship subpage; independent of any desktop service. */
final class CreatorPanel {
  final BusinessScreen p;
  final Map<View,Integer> manualViews=new LinkedHashMap<>();
  CreatorAiPanel ai;
  java.util.function.BooleanSupplier entryCheck=()->false;
  boolean manualActive(){return ai!=null&&!ai.open&&p.isShown()&&entryCheck.getAsBoolean();}
  Button manualButton(LinearLayout parent,String title,Action action){Button b=p.button(parent,title,()->{});b.setOnClickListener(v->{if(manualActive()&&b.isShown()&&b.isEnabled())safe(action);});return b;}
  void configureAi(java.util.function.BooleanSupplier current,CreatorAiPanel.Commit commit,CreatorAiPanel.Picker picker){entryCheck=current;ai.configure(current,commit,picker);}
  void showManual(boolean visible){for(View child:manualViews.keySet()){if(!visible)manualViews.put(child,child.getVisibility());child.setVisibility(visible?manualViews.get(child):View.GONE);}}
  void enterAi(){safe(()->{clean();BusinessStore.require(versionId.isEmpty(),"请回到当前文稿后开始全文分块分析");showManual(false);p.state.setVisibility(View.GONE);ai.enter();});}
  void leaveAi(){showManual(true);show(view);}
  boolean backAi(){return index!=null&&index.back()||ai!=null&&ai.back();}
  final Spinner documents,versions,type,polarity;
  final ListView list;
  final ArrayAdapter<String> labels;
  final LinearLayout editor;
  final LinearLayout graphTools;
  final LinearLayout documentTools;
  final EditText focus;
  final ScrollView scroll;
  final TextView source,coverage,excerpt;
  final Graph graph;
  final CreatorIndexPanel index;
  final List<String> ids=new ArrayList<>();
  final List<JSONObject> snapshots=new ArrayList<>();
  JSONObject row=new JSONObject(),analysis=new JSONObject();JSONArray edges=new JSONArray();
  String id="",hash="",previous="",versionId="";
  int selected=-1,view=0;
  int baseType=0,basePolarity=0;
  boolean loading=false,dirty=false;
  Button save,remove,selectedText;
  interface Action {void run()throws Exception;}
  void safe(Action action){if(ai!=null&&ai.open)return;try{action.run();}catch(Exception e){p.state.setVisibility(View.VISIBLE);p.state.setText(e.getMessage());}}
  boolean changed(){return dirty||type.getSelectedItemPosition()!=baseType||polarity.getSelectedItemPosition()!=basePolarity;}
  void acceptForm(){dirty=false;baseType=type.getSelectedItemPosition();basePolarity=polarity.getSelectedItemPosition();}
  void clean(){BusinessStore.require(!changed(),"关系草稿未保存；请先保存或放弃草稿");}
  LinearLayout bar(LinearLayout parent){LinearLayout b=new LinearLayout(p.owner);parent.addView(b);return b;}
  CreatorPanel(BusinessScreen screen)throws Exception {
    p=screen;
    documents=p.choices(p.body,new ArrayList<>());documents.setTag("creatorDocuments");versions=p.choices(p.body,new ArrayList<>());versions.setTag("creatorVersions");
    LinearLayout nav=bar(p.body);manualButton(nav,"关系列表",()->show(0));manualButton(nav,"关系图",()->show(1));manualButton(nav,"原文 / 编辑",()->show(2));manualButton(nav,"作者汇总",()->show(3));
    LinearLayout tools=bar(p.body);documentTools=tools;manualButton(tools,"重读文稿",()->safe(()->{clean();load(id);}));manualButton(tools,"新增关系",()->safe(()->{clean();clearForm();show(2);}));manualButton(tools,"放弃草稿",()->safe(()->{acceptForm();load(id);}));
    list=new ListView(p.owner);list.setTag("creatorRelations");labels=new ArrayAdapter<>(p.owner,android.R.layout.simple_list_item_1,new ArrayList<>());list.setAdapter(labels);p.body.addView(list,new LinearLayout.LayoutParams(-1,0,1));
    graphTools=bar(p.body);focus=new EditText(p.owner);focus.setTextSize(13);focus.setSingleLine(true);focus.setHint("定位实体（默认首个）");focus.setTag("creatorFocus");graphTools.addView(focus,new LinearLayout.LayoutParams(0,p.owner.dp(48),2));
    graph=new Graph();manualButton(graphTools,"定位",()->safe(()->graph.rebuild()));manualButton(graphTools,"复位",()->{graph.zoom=1;graph.panX=graph.panY=0;graph.invalidate();});graph.setTag("creatorGraph");p.body.addView(graph,new LinearLayout.LayoutParams(-1,0,1));
    coverage=p.text("局部图最多12条；完整列表不截断。双指缩放、单指平移；点击连线看引文。");p.body.addView(coverage);
    scroll=new ScrollView(p.owner);p.body.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));editor=new LinearLayout(p.owner);editor.setOrientation(LinearLayout.VERTICAL);scroll.addView(editor);
    excerpt=p.text("");excerpt.setTextIsSelectable(true);excerpt.setTag("creatorExcerpt");editor.addView(excerpt);
    source=p.text("");source.setTag("creatorSource");source.setTextIsSelectable(true);source.setMaxLines(9);editor.addView(source);manualButton(editor,"展开 / 收起完整原文",()->source.setMaxLines(source.getMaxLines()==9?Integer.MAX_VALUE:9));
    selectedText=manualButton(editor,"使用选中原文",()->{int a=source.getSelectionStart(),b=source.getSelectionEnd();if(a>=0&&b>a)p.inputs.get("creatorQuote").setText(source.getText().subSequence(a,b));else p.state.setText("请先长按选中连续原文");});
    field("本篇摘要","creatorSummary");field("主题","creatorTopic");field("来源实体","creatorFrom");field("目标实体","creatorTo");
    type=p.choices(editor,CreatorAnalysis.TYPES);polarity=p.choices(editor,Arrays.asList("支持观点","相反观点"));
    EditText quote=field("12至500字连续原文，须包含两个实体","creatorQuote");quote.setSingleLine(false);quote.setMinLines(3);quote.setLayoutParams(new LinearLayout.LayoutParams(-1,-2));
    field("疑点 / 观点范围","creatorUncertainty");LinearLayout actions=bar(editor);save=manualButton(actions,"保存关系修订",()->safe(()->persist(false)));remove=manualButton(actions,"移除选中关系",()->safe(()->persist(true)));
    for(String key:keys())p.inputs.get(key).addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int n){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int a,int b,int c){if(!loading)dirty=true;}});
    documents.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> a,View v,int n,long item){if(loading||!manualActive()||n<0||n>=ids.size()||ids.get(n).equals(id))return;safe(()->{clean();load(ids.get(n));});if(!ids.get(n).equals(id))documents.setSelection(ids.indexOf(id));}public void onNothingSelected(AdapterView<?> a){}});
    versions.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> a,View v,int n,long item){if(loading||!manualActive()||n<0||n>=snapshots.size())return;String target=n==0?"":snapshots.get(n).optString("id");if(target.equals(versionId))return;safe(()->{clean();versionId=target;analysis=n==0?CreatorAnalysis.current(row):snapshots.get(n);display();});if(!target.equals(versionId))for(int i=0;i<snapshots.size();i++)if((i==0?"":snapshots.get(i).optString("id")).equals(versionId))versions.setSelection(i);}public void onNothingSelected(AdapterView<?> a){}});
    list.setOnItemClickListener((a,v,n,item)->{if(manualActive()&&list.isShown())safe(()->select(n));});
    index=new CreatorIndexPanel(this);p.body.addView(index,new LinearLayout.LayoutParams(-1,0,1));load("");
    Button aiEntry=manualButton(p.body,"全文分块关系分析",this::enterAi);aiEntry.setTag("creatorAiOpen");
    for(int i=0;i<p.body.getChildCount();i++){View child=p.body.getChildAt(i);manualViews.put(child,child.getVisibility());}
    ai=new CreatorAiPanel(p,()->row,this::leaveAi,(documentId,analysisId)->{load(documentId);for(int i=1;i<snapshots.size();i++)if(analysisId.equals(snapshots.get(i).optString("id"))){versionId=analysisId;analysis=snapshots.get(i);versions.setSelection(i);display();break;}show(1);p.state.setText("作者分析已追加历史 · "+analysisId+"；作者观点，未外部核验。");});
    p.body.addView(ai,new LinearLayout.LayoutParams(-1,0,1));
  }
  static List<String> keys(){return Arrays.asList("creatorSummary","creatorTopic","creatorFrom","creatorTo","creatorQuote","creatorUncertainty");}
  EditText field(String label,String key){return p.field(editor,label,key,"",false);}
  void load(String wanted)throws Exception {
    clean();loading=true;JSONArray all=p.store.read("collections");ids.clear();List<String> names=new ArrayList<>();row=new JSONObject();
    for(int i=0;i<all.length();i++){JSONObject r=all.getJSONObject(i);ids.add(r.getString("id"));names.add(r.optString("channel")+" · "+r.optString("title"));if(r.getString("id").equals(wanted))row=r;}
    if(row.length()==0&&all.length()>0)row=all.getJSONObject(0);id=row.optString("id");hash=CollectionQuality.bodyHash(row.optString("text"));previous=CreatorAnalysis.lastId(row);versionId="";
    ArrayAdapter<String> adapter=(ArrayAdapter<String>)documents.getAdapter();adapter.clear();adapter.addAll(names);adapter.notifyDataSetChanged();documents.setSelection(Math.max(0,ids.indexOf(id)));
    JSONArray history=CollectionQuality.array(row,"creatorAnalyses");snapshots.clear();snapshots.add(new JSONObject());names=new ArrayList<>();names.add("当前合格分析（可编辑）");for(int i=history.length()-1;i>=0;i--){JSONObject a=history.getJSONObject(i);snapshots.add(a);names.add("历史 #"+(i+1)+" · "+a.optString("analyzedAt")+" · 只读");}
    adapter=(ArrayAdapter<String>)versions.getAdapter();adapter.clear();adapter.addAll(names);adapter.notifyDataSetChanged();versions.setSelection(0);analysis=CreatorAnalysis.current(row);loading=false;display();
  }
  void clearForm(){loading=true;selected=-1;for(String key:keys())if(!key.equals("creatorSummary"))p.inputs.get(key).setText("");type.setSelection(0);polarity.setSelection(0);baseType=basePolarity=0;loading=false;}
  void display()throws Exception {
    loading=true;edges=CollectionQuality.array(analysis,"relations");labels.clear();for(int i=0;i<edges.length();i++){JSONObject e=edges.getJSONObject(i);labels.add(e.optString("from")+" → "+e.optString("to")+"\n"+e.optString("relation")+" · "+e.optString("topic")+" · "+(e.optString("polarity").equals("contradicts")?"相反观点":"作者观点"));}labels.notifyDataSetChanged();
    excerpt.setText("来源："+CreatorAnalysis.sourceLabel(analysis,row)+"\n正文身份："+analysis.optString("bodyHash",CollectionQuality.bodyHash(row.optString("text")))+"\n点列表或连线查看引用片段。");
    source.setText(analysis.optString("bodyText",row.optString("text")));p.inputs.get("creatorSummary").setText(analysis.optString("summary"));clearForm();dirty=false;
    boolean enabled=versionId.isEmpty()&&CreatorAnalysis.eligible(row);save.setEnabled(enabled);remove.setEnabled(enabled);selectedText.setEnabled(versionId.isEmpty());
    p.state.setText((versionId.isEmpty()?(CreatorAnalysis.eligible(row)?analysis.length()==0?"当前文稿尚未记录分析":edges.length()==0?"本篇已记录：无明确关系":"读取时当前合格关系":"质检不满足，旧分析不入当前图"):"历史快照 · 只读")+" · "+edges.length()+"条\n作者观点，未外部核验");
    for(String key:keys())p.inputs.get(key).setEnabled(versionId.isEmpty());type.setEnabled(versionId.isEmpty());polarity.setEnabled(versionId.isEmpty());
    graph.rebuild();loading=false;show(view);
  }
  void select(int n)throws Exception {
    clean();BusinessStore.require(n>=0&&n<edges.length(),"关系不存在");selected=n;loading=true;JSONObject e=edges.getJSONObject(n);
    p.inputs.get("creatorTopic").setText(e.optString("topic"));p.inputs.get("creatorFrom").setText(e.optString("from"));p.inputs.get("creatorTo").setText(e.optString("to"));p.inputs.get("creatorQuote").setText(e.optString("quote"));p.inputs.get("creatorUncertainty").setText(e.optString("uncertainty"));baseType=CreatorAnalysis.TYPES.indexOf(e.optString("relation"));basePolarity=e.optString("polarity").equals("contradicts")?1:0;type.setSelection(baseType);polarity.setSelection(basePolarity);loading=false;
    String body=analysis.optString("bodyText",row.optString("text")),q=e.optString("quote");excerpt.setText("连续原文引用（未外部核验）\n"+q+"\n来源："+CreatorAnalysis.sourceLabel(analysis,row)+"\n疑点："+e.optString("uncertainty"));SpannableString marked=new SpannableString(body);int at=body.indexOf(q);if(at>=0)marked.setSpan(new BackgroundColorSpan(0x55e3b54f),at,at+q.length(),Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);source.setText(marked);show(2);scroll.scrollTo(0,0);
  }
  void persist(boolean erase)throws Exception {
    BusinessStore.require(versionId.isEmpty(),"历史版本只读");JSONArray next=new JSONArray(edges.toString());
    if(erase){BusinessStore.require(selected>=0,"先选中要移除的关系");clean();next.remove(selected);}
    else {JSONObject edge=new JSONObject().put("topic",p.value("creatorTopic")).put("from",p.value("creatorFrom")).put("to",p.value("creatorTo")).put("relation",type.getSelectedItem()).put("quote",p.value("creatorQuote")).put("polarity",polarity.getSelectedItemPosition()==1?"contradicts":"supports").put("uncertainty",p.value("creatorUncertainty"));if(selected<0)next.put(edge);else next.put(selected,edge);}
    p.store.saveCreatorAnalysis(id,hash,previous,p.value("creatorSummary"),next);acceptForm();load(id);show(0);p.state.setText("关系修订已保存在手机；旧版本与原文保留，事实未核验。");
  }
  void openIndexed(JSONObject evidence)throws Exception{
    clean();String wanted=evidence.optString("documentId",evidence.optString("id"));JSONObject target=new JSONObject();JSONArray all=p.store.read("collections");for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optString("id").equals(wanted))target=all.getJSONObject(i);BusinessStore.require(target.length()!=0,"文稿已变化，请重读汇总");
    String analysisId=evidence.optString("analysisId");if(!analysisId.isEmpty()){JSONObject found=new JSONObject();JSONArray history=CollectionQuality.array(target,"creatorAnalyses");for(int i=0;i<history.length();i++)if(history.getJSONObject(i).optString("id").equals(analysisId))found=history.getJSONObject(i);BusinessStore.require(found.length()!=0&&found.optString("bodyHash").equals(evidence.optString("bodyHash")),"分析快照已变化，请重读汇总");}
    load(wanted);if(!analysisId.isEmpty()){for(int i=1;i<snapshots.size();i++)if(snapshots.get(i).optString("id").equals(analysisId)){versionId=analysisId;analysis=snapshots.get(i);versions.setSelection(i);display();break;}select(evidence.getInt("edgeIndex"));}else show(2);
  }
  void show(int which){view=which;list.setVisibility(view==0?View.VISIBLE:View.GONE);graphTools.setVisibility(view==1?View.VISIBLE:View.GONE);graph.setVisibility(view==1?View.VISIBLE:View.GONE);coverage.setVisibility(view==1?View.VISIBLE:View.GONE);scroll.setVisibility(view==2?View.VISIBLE:View.GONE);for(View control:Arrays.asList(documents,versions,documentTools,p.state))control.setVisibility(view==3?View.GONE:View.VISIBLE);if(index!=null)index.show(view==3);}
  Bundle saveState(){Bundle b=new Bundle();b.putString("id",id);b.putString("hash",hash);b.putString("previous",previous);b.putString("version",versionId);b.putInt("selected",selected);b.putInt("view",view);b.putBoolean("dirty",changed());b.putInt("type",type.getSelectedItemPosition());b.putInt("polarity",polarity.getSelectedItemPosition());b.putBundle("index",index.saveState());if(ai!=null)b.putBundle("creatorAi",ai.saveState());return b;}
  void restoreState(Bundle b){if(b==null)return;safe(()->{Map<String,String> draft=new HashMap<>();for(String key:keys())draft.put(key,p.value(key));dirty=false;baseType=type.getSelectedItemPosition();basePolarity=polarity.getSelectedItemPosition();load(b.getString("id",""));hash=b.getString("hash",hash);previous=b.getString("previous",previous);versionId=b.getString("version","");
      analysis=versionId.isEmpty()?CreatorAnalysis.current(row):new JSONObject();for(int i=1;i<snapshots.size();i++)if(snapshots.get(i).optString("id").equals(versionId)){analysis=snapshots.get(i);versions.setSelection(i);}display();
      loading=true;for(String key:keys())p.inputs.get(key).setText(draft.get(key));selected=b.getInt("selected",-1);if(selected>=edges.length())selected=-1;if(selected>=0){JSONObject e=edges.getJSONObject(selected);baseType=CreatorAnalysis.TYPES.indexOf(e.optString("relation"));basePolarity=e.optString("polarity").equals("contradicts")?1:0;}type.setSelection(b.getInt("type"));polarity.setSelection(b.getInt("polarity"));dirty=b.getBoolean("dirty");loading=false;show(b.getInt("view"));
      index.restoreState(b.getBundle("index"));
      if(ai!=null&&ai.restoreState(b.getBundle("creatorAi"))&&!changed()){showManual(false);p.state.setVisibility(View.GONE);ai.enter();}
    });}
  final class Graph extends View {
    final Paint paint=new Paint(3);final List<Integer> shown=new ArrayList<>();float zoom=1,panX=0,panY=0,lastX,lastY,downX,downY;boolean scaled=false;
    final ScaleGestureDetector detector;
    Graph(){super(p.owner);setContentDescription("作者观点局部关系图；可切换完整列表读取所有关系");detector=new ScaleGestureDetector(p.owner,new ScaleGestureDetector.SimpleOnScaleGestureListener(){public boolean onScale(ScaleGestureDetector d){zoom=Math.max(.5f,Math.min(3,zoom*d.getScaleFactor()));scaled=true;invalidate();return true;}});}
    void rebuild()throws Exception {shown.clear();String entity=CollectionQuality.trim(focus.getText().toString());if(entity.isEmpty())entity=edges.length()==0?"":edges.getJSONObject(0).optString("from");int total=0;for(int i=0;i<edges.length();i++){JSONObject e=edges.getJSONObject(i);if(!e.optString("from").equals(entity)&&!e.optString("to").equals(entity))continue;total++;if(shown.size()<12)shown.add(i);}coverage.setText("局部实体："+entity+" · "+shown.size()+" / "+total+"相邻关系 · 全篇"+edges.length()+"条\n双指缩放、单指平移，点连线看原文；完整列表不截断。");zoom=1;panX=panY=0;invalidate();}
    void text(Canvas c,String value,float x,float y,float width){paint.setTextSize(p.owner.dp(13));int n=paint.breakText(value,true,width,null);c.drawText(n<value.length()?value.substring(0,Math.max(0,n-1))+"…":value,x,y,paint);}
    protected void onDraw(Canvas c){super.onDraw(c);c.save();c.translate(panX,panY);c.scale(zoom,zoom);float w=getWidth(),unit=p.owner.dp(88);paint.setColor(p.owner.darkTheme()?0xffdae5f5:0xff1f3048);if(shown.isEmpty())text(c,"暂无可绘制关系，请先查看文稿状态",10,50,w-20);
      for(int k=0;k<shown.size();k++){JSONObject e=edges.optJSONObject(shown.get(k));float y=unit*k+p.owner.dp(42);paint.setColor(p.owner.darkTheme()?0xffdae5f5:0xff1f3048);text(c,e.optString("from"),8,y,w*.31f);text(c,e.optString("to"),w*.69f,y,w*.29f);paint.setColor(e.optString("polarity").equals("contradicts")?0xffb36c28:0xff317ba8);paint.setStrokeWidth(p.owner.dp(2));c.drawLine(w*.34f,y-5,w*.65f,y-5,paint);c.drawLine(w*.65f,y-5,w*.62f,y-11,paint);c.drawLine(w*.65f,y-5,w*.62f,y+1,paint);text(c,e.optString("relation"),w*.38f,y-14,w*.26f);text(c,e.optString("polarity").equals("contradicts")?"相反观点":"作者观点",w*.38f,y+20,w*.26f);}c.restore();}
    public boolean onTouchEvent(MotionEvent e){if(!manualActive()||!isShown())return false;detector.onTouchEvent(e);float x=e.getX(),y=e.getY();if(e.getActionMasked()==MotionEvent.ACTION_DOWN){downX=lastX=x;downY=lastY=y;scaled=false;return true;}if(e.getActionMasked()==MotionEvent.ACTION_MOVE){if(!detector.isInProgress()){panX+=x-lastX;panY+=y-lastY;invalidate();}lastX=x;lastY=y;return true;}if(e.getActionMasked()==MotionEvent.ACTION_UP){if(!scaled&&Math.hypot(x-downX,y-downY)<p.owner.dp(8)){int n=(int)((y-panY)/zoom/p.owner.dp(88));if(n>=0&&n<shown.size())safe(()->select(shown.get(n)));performClick();}return true;}return true;}
    public boolean performClick(){super.performClick();return true;}
  }
}
