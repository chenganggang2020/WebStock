package org.marketreview.nativeapp;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native independent-device read-only index, with small restore state. */
final class CreatorIndexPanel extends LinearLayout {
  static final ExecutorService READERS=Executors.newFixedThreadPool(2);
  final CreatorPanel parent;
  CreatorRelationsPanel relations;
  final List<View> relationSiblings=new ArrayList<>();
  int indexRow,indexTop,indexControlsY;
  final BusinessScreen p;
  final Spinner authors,topics,mode;
  final TextView counts,pageLabel;
  final ListView list;
  final Button previous,next;
  final ArrayAdapter<String> labels;
  final List<String> authorKeys=new ArrayList<>(),topicKeys=new ArrayList<>();
  JSONObject result=new JSONObject();JSONArray visible=new JSONArray();
  String authorKey="",topicKey="";
  int page=0,modeValue=0;
  boolean wide;
  final LinearLayout controls,results;
  final ScrollView controlsScroll;
  boolean started=false,binding=false;
  AtomicBoolean cancelled=new AtomicBoolean();
  CreatorIndexPanel(CreatorPanel parent){
    super(parent.p.owner);this.parent=parent;p=parent.p;wide=getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;setOrientation(VERTICAL);setVisibility(GONE);
    controlsScroll=new ScrollView(p.owner);controls=new LinearLayout(p.owner);controls.setOrientation(VERTICAL);controlsScroll.addView(controls);addView(controlsScroll);
    results=new LinearLayout(p.owner);results.setOrientation(VERTICAL);addView(results);
    LinearLayout filters=parent.bar(controls);authors=p.choices(filters,new ArrayList<>());authors.setTag("creatorIndexAuthor");topics=p.choices(filters,new ArrayList<>());topics.setTag("creatorIndexTopic");
    for(Spinner spinner:Arrays.asList(authors,topics))spinner.setLayoutParams(new LayoutParams(0,p.owner.dp(48),1));
    LinearLayout toolbar=parent.bar(controls);p.button(toolbar,"重读汇总",()->{if(indexActive())refresh(false);});p.button(toolbar,"放弃关系草稿",()->{if(indexActive())parent.safe(()->{parent.acceptForm();parent.load(parent.id);});});mode=p.choices(toolbar,Arrays.asList("合格引文","全部文稿"));mode.setTag("creatorIndexMode");mode.setLayoutParams(new LayoutParams(0,p.owner.dp(48),1));
    p.button(toolbar,"跨文稿关系图 / 旧档案",this::openRelations).setTag("creatorRelationsOpen");
    counts=p.text("");counts.setTag("creatorIndexCounts");controls.addView(counts);list=new ListView(p.owner);list.setTag("creatorIndexRows");labels=new ArrayAdapter<String>(p.owner,android.R.layout.simple_list_item_1,new ArrayList<>()) {public View getView(int position,View old,ViewGroup box){TextView text=(TextView)super.getView(position,old,box);text.setTextColor(p.owner.darkTheme()?0xffdae5f5:0xff1f3048);return text;}};list.setAdapter(labels);results.addView(list,new LayoutParams(-1,0,1));
    LinearLayout nav=parent.bar(results);previous=p.button(nav,"上一页",()->{if(indexActive()){page--;parent.safe(this::render);}});pageLabel=p.text("");nav.addView(pageLabel,new LayoutParams(0,-2,2));next=p.button(nav,"下一页",()->{if(indexActive()){page++;parent.safe(this::render);}});
    authors.setOnItemSelectedListener(listener(()->{if(binding||!indexActive())return;int n=authors.getSelectedItemPosition();if(n<0||n>=authorKeys.size()||authorKeys.get(n).equals(authorKey))return;authorKey=authorKeys.get(n);refresh(false);}));
    topics.setOnItemSelectedListener(listener(()->{if(binding||!indexActive())return;int n=topics.getSelectedItemPosition();if(n<0||n>=topicKeys.size()||topicKeys.get(n).equals(topicKey))return;topicKey=topicKeys.get(n);refresh(false);}));
    mode.setOnItemSelectedListener(listener(()->{int selected=mode.getSelectedItemPosition();if(!binding&&indexActive()&&modeValue!=selected){modeValue=selected;page=0;parent.safe(this::render);}}));
    list.setOnItemClickListener((a,v,n,id)->parent.safe(()->{if(indexActive()&&n>=0&&n<visible.length())parent.openIndexed(visible.getJSONObject(n));}));
    arrange();
  }
  void arrange(){wide=getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;setOrientation(relations==null&&wide?HORIZONTAL:VERTICAL);controlsScroll.setLayoutParams(new LayoutParams(wide?p.owner.dp(300):-1,wide?-1:-2));results.setLayoutParams(wide?new LayoutParams(0,-1,1):new LayoutParams(-1,0,1));if(relations==null&&result.has("counts"))parent.safe(()->accept(result,authorKey,topicKey));}
  protected void onConfigurationChanged(android.content.res.Configuration configuration){super.onConfigurationChanged(configuration);arrange();}
  AdapterView.OnItemSelectedListener listener(Runnable action){return new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> a,View v,int n,long id){action.run();}public void onNothingSelected(AdapterView<?> a){}};}
  boolean indexActive(){return relations==null&&isShown()&&parent.manualActive();}
  void openRelations(){
    if(!indexActive()||!result.has("counts"))return;
    cancelled.set(true);indexRow=list.getFirstVisiblePosition();indexTop=list.getChildCount()==0?0:list.getChildAt(0).getTop();indexControlsY=controlsScroll.getScrollY();
    CreatorRelationsPanel next=new CreatorRelationsPanel(p.owner,()->p.store.read("collections"),new CreatorArchiveStore(new java.io.File(p.owner.getFilesDir(),p.owner.testing?"creator-archive-test.json":"creator-archive-v1.json")),e->{parent.openIndexed(e);closeRelations();},()->relations!=null&&isShown()&&parent.manualActive());
    relations=next;next.author=authorKey;next.topic=topicKey;next.onBack=this::closeRelations;relationSiblings.clear();for(int i=0;i<p.body.getChildCount();i++){View child=p.body.getChildAt(i);if(child!=this&&child.getVisibility()==VISIBLE){relationSiblings.add(child);child.setVisibility(GONE);}}controlsScroll.setVisibility(GONE);results.setVisibility(GONE);setOrientation(VERTICAL);addView(next,new LayoutParams(-1,0,1));SourceHandoffPanel.styleTree(next,p.owner.darkTheme());next.reload();
  }
  boolean closeRelations(){
    if(relations==null)return false;CreatorRelationsPanel old=relations;relations=null;old.close();removeView(old);for(View child:relationSiblings)child.setVisibility(VISIBLE);relationSiblings.clear();setOrientation(wide?HORIZONTAL:VERTICAL);controlsScroll.setVisibility(VISIBLE);results.setVisibility(VISIBLE);
    controlsScroll.getViewTreeObserver().addOnGlobalLayoutListener(new android.view.ViewTreeObserver.OnGlobalLayoutListener(){public void onGlobalLayout(){controlsScroll.getViewTreeObserver().removeOnGlobalLayoutListener(this);if(relations==null){controlsScroll.scrollTo(0,indexControlsY);list.setSelectionFromTop(indexRow,indexTop);}}});controlsScroll.requestLayout();return true;
  }
  boolean back(){return relations!=null&&relations.back();}
  protected void onVisibilityChanged(View v,int visibility){super.onVisibilityChanged(v,visibility);if(relations!=null&&!isShown())closeRelations();}
  void show(boolean value){setVisibility(value?VISIBLE:GONE);if(value&&!started)refresh(true);}
  protected void onDetachedFromWindow(){closeRelations();cancelled.set(true);started=false;super.onDetachedFromWindow();}
  protected void onAttachedToWindow(){super.onAttachedToWindow();if(getVisibility()==VISIBLE&&!started)refresh(true);}
  void refresh(boolean keepPage){
    started=true;cancelled.set(true);cancelled=new AtomicBoolean();AtomicBoolean token=cancelled;String author=authorKey,topic=topicKey;if(!keepPage)page=0;
    result=new JSONObject();visible=new JSONArray();labels.clear();list.setEnabled(false);previous.setEnabled(false);next.setEnabled(false);counts.setText("正在本机读取…不调用电脑或网络");
    READERS.execute(()->{JSONObject value=null;String error="";try{if(token.get())return;value=CreatorIndex.build(p.store.read("collections"),author,topic,token::get);}catch(Exception e){error=e.getMessage();}
      JSONObject done=value;String failure=error;p.owner.runOnUiThread(()->{if(token.get()||p.owner.isDestroyed())return;parent.safe(()->{if(done!=null)accept(done,author,topic);else counts.setText(failure);});});
    });
  }
  void options(Spinner spinner,List<String> values,int selected){ArrayAdapter<String> adapter=(ArrayAdapter<String>)spinner.getAdapter();adapter.clear();adapter.addAll(values);adapter.notifyDataSetChanged();spinner.setSelection(Math.max(0,selected));}
  void accept(JSONObject value,String author,String topic)throws Exception{
    result=value;binding=true;authorKeys.clear();authorKeys.add("");List<String> names=new ArrayList<>();names.add("全部作者（按身份）");JSONArray all=result.getJSONArray("authors");
    for(int i=0;i<all.length();i++){JSONObject a=all.getJSONObject(i);String key=a.getString("authorKey");authorKeys.add(key);JSONArray aliases=a.getJSONArray("aliases");List<String> parts=new ArrayList<>();for(int n=0;n<aliases.length();n++)parts.add(aliases.getString(n));names.add((parts.isEmpty()?"未知作者":String.join(" / ",parts))+" · "+key);}
    options(authors,names,authorKeys.indexOf(author));topicKeys.clear();topicKeys.add("");names=new ArrayList<>();names.add("全部主题");all=result.getJSONArray("topics");for(int i=0;i<all.length();i++){topicKeys.add(all.getString(i));names.add(all.getString(i));}if(!topic.isEmpty()&&!topicKeys.contains(topic)){topicKeys.add(topic);names.add(topic+"（无关系）");}options(topics,names,topicKeys.indexOf(topic));binding=false;
    JSONObject c=result.getJSONObject("counts");counts.setText("就绪 · 文稿 "+c.getInt("documents")+" / 去重作品 "+c.getInt("works")+" / 旧版 "+c.getInt("superseded")+(wide?" · ":"\n")+"已分析 "+c.getInt("analyzed")+"（无关系 "+c.getInt("empty")+"）· 待分析 "+c.getInt("pending")+" · 未准入 "+c.getInt("blocked")+"\n筛选引文 "+c.getInt("relations")+" 条 · 点击回原文快照"+(wide?" · ":"\n")+"主题仅筛引文；作者观点未核验。更新后请重读。");list.setEnabled(true);render();
  }
  void render()throws Exception{
    boolean docs=mode.getSelectedItemPosition()==1;JSONArray rows=CollectionQuality.array(result,docs?"documents":"relations");page=Math.max(0,Math.min(page,Math.max(0,(rows.length()-1)/100)));visible=new JSONArray();labels.clear();
    for(int i=page*100;i<Math.min(rows.length(),page*100+100);i++){JSONObject r=rows.getJSONObject(i);visible.put(r);
      if(docs){String status=r.optString("status"),label=status.equals("blocked")?"未准入":status.equals("pending")?"待分析":status.equals("superseded")?"来源旧版":"已分析";labels.add(r.optString("title")+"\n"+r.optString("channel")+" · "+label+"\n"+r.optString("reason"));}
      else{JSONObject e=r.getJSONObject("edge"),source=r.getJSONObject("sourceSnapshot");labels.add(e.getString("from")+" → "+e.getString("to")+" · "+e.getString("topic")+"\n"+(e.getString("polarity").equals("contradicts")?"相反观点":"支持观点")+" · "+e.getString("relation")+"\n"+source.optString("channel")+" · "+source.optString("title")+"\n"+e.getString("quote"));}
    }
    labels.notifyDataSetChanged();pageLabel.setText("第 "+(page+1)+" / "+Math.max(1,(rows.length()+99)/100)+" 页 · 共 "+rows.length()+" 条 · 每页100条");previous.setEnabled(page>0);next.setEnabled((page+1)*100<rows.length());
  }
  Bundle saveState(){Bundle b=new Bundle();b.putString("author",authorKey);b.putString("topic",topicKey);b.putInt("mode",mode.getSelectedItemPosition());b.putInt("page",page);return b;}
  void restoreState(Bundle b){if(b==null)return;cancelled.set(true);started=false;authorKey=b.getString("author","");topicKey=b.getString("topic","");binding=true;modeValue=b.getInt("mode");mode.setSelection(modeValue);page=b.getInt("page");binding=false;if(getVisibility()==VISIBLE)refresh(true);}
}
