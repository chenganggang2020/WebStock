package org.marketreview.nativeapp;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

/** Complete local cross-document read-only graph and explicit legacy archive workflow. */
final class CreatorRelationsPanel extends LinearLayout {
  interface Open {void run(JSONObject evidence)throws Exception;}
  interface Work {void run()throws Exception;}
  final Activity owner;final CreatorArchiveStore.Source source;final CreatorArchiveStore store;final Open open;final BooleanSupplier current;
  final Spinner authors,topics,mode;final EditText focus;final TextView counts;final ClaimGraph graph;final ListView history;final ArrayAdapter<String> labels;
  final Button previous,next,confirm;final List<String> authorKeys=new ArrayList<>(),topicKeys=new ArrayList<>();
  JSONObject index=new JSONObject(),projection=new JSONObject(),pending=new JSONObject();JSONArray records=new JSONArray(),visible=new JSONArray();String author="",topic="";int page,modeValue;boolean binding;volatile boolean closed;volatile long epoch;
  final ExecutorService worker=Executors.newSingleThreadExecutor();
  static void show(CreatorIndexPanel index){index.openRelations();}
  final LinearLayout tools,workspace,readerPane;final ScrollView toolsScroll,fullScroll;
  final TextView fullText,readerTitle;final Button backButton,toolsButton,evidenceOpen;
  Runnable onBack;Work readerAction;String screen="graph",readerReturn="graph";boolean reading;
  boolean toolsActive(){return alive()&&!reading&&screen.equals("tools");}
  void setScreen(String value){screen=value;workspace.setVisibility(value.equals("graph")?VISIBLE:GONE);toolsScroll.setVisibility(value.equals("tools")?VISIBLE:GONE);toolsButton.setText(value.equals("graph")?"筛选 / 旧档案":"查看图 / 记录");}
  boolean back(){
    if(!alive())return false;
    if(reading){reading=false;readerAction=null;readerPane.setVisibility(GONE);setScreen(readerReturn);toolsButton.setVisibility(VISIBLE);backButton.setText("返回作者汇总");return true;}
    if(screen.equals("tools")){invalidatePreview();setScreen("graph");return true;}
    if(onBack!=null)onBack.run();return true;
  }
  CreatorRelationsPanel(Activity activity,CreatorArchiveStore.Source source,CreatorArchiveStore store,Open open,BooleanSupplier current){
    super(activity);owner=activity;this.source=source;this.store=store;this.open=open;this.current=current;setOrientation(VERTICAL);setPadding(dp(10),dp(8),dp(10),dp(8));setTag("creatorRelationsPanel");
    LinearLayout navigation=new LinearLayout(owner);addView(navigation,new LayoutParams(-1,dp(48)));
    backButton=button(navigation,"返回作者汇总","creatorRelationsBack",()->back());toolsButton=button(navigation,"筛选 / 旧档案","creatorRelationsTools",()->{invalidatePreview();setScreen(screen.equals("graph")?"tools":"graph");});
    toolsScroll=new ScrollView(owner);toolsScroll.setTag("creatorRelationsToolsPage");tools=new LinearLayout(owner);tools.setOrientation(VERTICAL);toolsScroll.addView(tools);addView(toolsScroll,new LayoutParams(-1,0,1));toolsScroll.setVisibility(GONE);
    workspace=new LinearLayout(owner);workspace.setOrientation(VERTICAL);workspace.setTag("creatorRelationsGraphPage");addView(workspace,new LayoutParams(-1,0,1));
    readerPane=new LinearLayout(owner);readerPane.setOrientation(VERTICAL);readerPane.setTag("creatorRelationsReaderPage");readerPane.setVisibility(GONE);addView(readerPane,new LayoutParams(-1,0,1));
    readerTitle=text("");readerPane.addView(readerTitle);fullScroll=new ScrollView(owner);fullScroll.setTag("creatorRelationsReaderScroll");readerPane.addView(fullScroll,new LayoutParams(-1,0,1));fullText=text("");fullText.setTextSize(14);fullText.setSaveEnabled(false);fullScroll.addView(fullText);
    LinearLayout readerActions=new LinearLayout(owner);readerPane.addView(readerActions);evidenceOpen=button(readerActions,"回原有精确分析","creatorRelationsEvidenceOpen",()->{if(reading&&readerAction!=null)readerAction.run();});evidenceOpen.setVisibility(GONE);
    LinearLayout filters=bar();authors=new Spinner(owner);authors.setTag("creatorRelationsAuthor");topics=new Spinner(owner);topics.setTag("creatorRelationsTopic");filters.addView(authors,new LayoutParams(0,dp(48),1));filters.addView(topics,new LayoutParams(0,dp(48),1));
    mode=new Spinner(owner);mode.setTag("creatorRelationsMode");mode.setAdapter(new ArrayAdapter<>(owner,android.R.layout.simple_spinner_dropdown_item,Arrays.asList("当前合格引文图","旧档案合格历史图","全部旧记录 / 冲突")));tools.addView(mode);
    LinearLayout location=bar();focus=new EditText(owner);focus.setSingleLine(true);focus.setTextSize(13);focus.setHint("精确实体文字筛选，不合并身份");focus.setTag("creatorRelationsFocus");location.addView(focus,new LayoutParams(0,dp(48),1));button(location,"定位","creatorRelationsLocate",this::locate);button(location,"重读","creatorRelationsReload",this::reload);
    counts=text("");counts.setTextSize(12);counts.setTag("creatorRelationsCounts");tools.addView(counts);
    graph=new ClaimGraph();graph.setTag("creatorRelationsGraph");workspace.addView(graph,new LayoutParams(-1,0,1));
    history=new ListView(owner);history.setTag("creatorArchiveRows");labels=new ArrayAdapter<>(owner,android.R.layout.simple_list_item_1,new ArrayList<>());history.setAdapter(labels);history.setVisibility(GONE);workspace.addView(history,new LayoutParams(-1,0,1));history.setOnItemClickListener((a,v,n,id)->{if(history.isShown())safe(()->evidence(visible.getJSONObject(n)));});
    LinearLayout nav=new LinearLayout(owner);workspace.addView(nav);previous=button(nav,"上一页","creatorRelationsPrevious",()->{page--;render();});next=button(nav,"下一页","creatorRelationsNext",()->{page++;render();});button(nav,"缩小","creatorRelationsZoomOut",()->graph.zoom(.8f));button(nav,"放大","creatorRelationsZoomIn",()->graph.zoom(1.25f));button(nav,"复位","creatorRelationsReset",()->graph.reset());
    LinearLayout files=bar();button(files,"旧文件预览","creatorArchiveChoose",()->{invalidatePreview();CreatorArchivePicker.launch(owner,this);});button(files,"完整预览","creatorArchiveRead",()->{CreatorArchive.need(pending.length()>0,"请先选择文件预览");reader("完整旧文件和绑定 / 冲突",pending.toString(2));});button(files,"取消","creatorArchiveCancel",()->{invalidatePreview();counts.setText("已取消，旧档案未修改");});
    LinearLayout save=bar();confirm=button(save,"明确保留全部旧版本并导入","creatorArchiveConfirm",this::commit);confirm.setEnabled(false);
    authors.setOnItemSelectedListener(listener(()->{int n=authors.getSelectedItemPosition();if(!binding&&toolsActive()&&n>=0&&n<authorKeys.size()&&!author.equals(authorKeys.get(n))){author=authorKeys.get(n);page=0;reload();}}));
    topics.setOnItemSelectedListener(listener(()->{int n=topics.getSelectedItemPosition();if(!binding&&n>=0&&n<topicKeys.size()&&!topic.equals(topicKeys.get(n))){topic=topicKeys.get(n);page=0;reload();}}));
    mode.setOnItemSelectedListener(listener(()->{int selected=mode.getSelectedItemPosition();if(!binding&&toolsActive()&&selected!=modeValue){modeValue=selected;page=0;invalidatePreview();safe(this::render);}}));
  }
  static String statusLabel(String s){switch(s){case "ready":return "准入通过，作者观点";case "unmatched":return "未匹配身份与作品编号";case "ambiguous":return "对应多篇，未任选";case "body-mismatch":return "正文哈希不同";case "quality-blocked":return "当前质检或来源未准入";case "legacy-rule":return "旧规则，仅保留历史";case "invalid-relations":return "关系或引文不合格";case "source-changed":return "原文或来源记录已变";default:return s;}}
  int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
  TextView text(String s){TextView t=new TextView(owner);t.setText(s);t.setTextIsSelectable(true);return t;}
  LinearLayout bar(){LinearLayout b=new LinearLayout(owner);tools.addView(b);return b;}
  Button button(LinearLayout bar,String name,String tag,Work action){Button b=new Button(owner);b.setText(name);b.setTextSize(12);b.setTag(tag);bar.addView(b,new LayoutParams(0,-2,1));b.setOnClickListener(v->{if(b.isShown()&&b.isEnabled())safe(action);});return b;}
  AdapterView.OnItemSelectedListener listener(Runnable r){return new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> p,View v,int n,long id){r.run();}public void onNothingSelected(AdapterView<?> p){}};}
  boolean alive(){return !closed&&isShown()&&current.getAsBoolean();}
  void safe(Work work){if(!alive())return;try{work.run();}catch(Exception e){counts.setText(e.getMessage());}}
  void invalidatePreview(){epoch++;pending=new JSONObject();if(confirm!=null)confirm.setEnabled(false);}
  void close(){closed=true;readerAction=null;invalidatePreview();worker.shutdownNow();}
  void locate()throws Exception{page=0;render();graph.reset();}
  protected void onDetachedFromWindow(){close();super.onDetachedFromWindow();}
  void options(Spinner box,List<String> names,int selected){box.setAdapter(new ArrayAdapter<>(owner,android.R.layout.simple_spinner_dropdown_item,names));box.setSelection(Math.max(0,selected));}
  void reload(){
    invalidatePreview();long ticket=epoch;String a=author,t=topic;counts.setText("正在本机读取完整作者索引…");
    worker.execute(()->{try{JSONArray rows=source.read();JSONObject i=CreatorIndex.build(rows,a,t,()->ticket!=epoch||closed),p=CreatorArchive.project(store.read(),rows,a,t);post(()->{if(!alive()||ticket!=epoch)return;safe(()->{index=i;projection=p;binding=true;
      authorKeys.clear();authorKeys.add("");List<String> names=new ArrayList<>();names.add("全部作者（按身份）");JSONArray all=i.getJSONArray("authors");for(int n=0;n<all.length();n++){JSONObject item=all.getJSONObject(n);authorKeys.add(item.getString("authorKey"));names.add(item.getJSONArray("aliases").toString()+" · "+item.getString("authorKey"));}options(authors,names,authorKeys.indexOf(a));
      Set<String> known=new TreeSet<>();all=i.getJSONArray("topics");for(int n=0;n<all.length();n++)known.add(all.getString(n));all=p.getJSONArray("records");for(int n=0;n<all.length();n++){JSONArray edges=all.getJSONObject(n).getJSONObject("original").optJSONArray("relations");if(edges!=null)for(int e=0;e<edges.length();e++)if(edges.optJSONObject(e)!=null)known.add(edges.getJSONObject(e).optString("topic"));}if(!t.isEmpty())known.add(t);topicKeys.clear();topicKeys.add("");topicKeys.addAll(known);names=new ArrayList<>();names.add("全部主题");names.addAll(known);options(topics,names,topicKeys.indexOf(t));binding=false;render();});});}catch(Exception e){post(()->{if(alive()&&ticket==epoch)counts.setText(e.getMessage());});}});
  }
  void previewBytes(byte[] raw){
    if(!toolsActive())return;invalidatePreview();long ticket=epoch;String a=author;counts.setText("正在核对旧文件与来源；尚未导入");
    worker.execute(()->{try{JSONObject value=CreatorArchive.preview(raw,a,source.read(),store.read());post(()->{if(!alive()||ticket!=epoch)return;safe(()->{pending=value;confirm.setEnabled(!value.getBoolean("duplicate"));counts.setText("预览 "+value.getJSONArray("rows").length()+" 条 · 冲突 "+value.getInt("conflicts")+" · 重复 "+value.getBoolean("duplicate")+"\n未匹配/旧规则/未准入仅保留历史；确认不覆盖任何原文或旧版本。");reader("完整旧文件和绑定（尚未导入）",value.toString(2));});});}catch(Exception e){post(()->{if(alive()&&ticket==epoch)counts.setText(e.getMessage());});}});
  }
  void commit()throws Exception{
    CreatorArchive.need(toolsActive()&&hasWindowFocus()&&pending.length()>0,"导入预览已失效或当前页面未获焦点");JSONObject held=new JSONObject(pending.toString());long ticket=epoch;
    store.save(held,source,()->ticket!=epoch||!alive());invalidatePreview();reload();
  }
  void render()throws Exception{
    boolean table=mode.getSelectedItemPosition()==2;JSONArray relations=CollectionQuality.array(mode.getSelectedItemPosition()==1?projection:index,"relations");records=CollectionQuality.array(projection,"records");
    JSONObject g=CreatorArchive.graph(relations,focus.getText().toString().trim(),page);int total=table?records.length():g.getInt("filtered");page=Math.max(0,Math.min(page,Math.max(0,(total-1)/40)));previous.setEnabled(page>0);next.setEnabled((page+1)*40<total);graph.setVisibility(table?GONE:VISIBLE);history.setVisibility(table?VISIBLE:GONE);
    if(table){labels.clear();visible=new JSONArray();for(int n=page*40;n<Math.min(records.length(),page*40+40);n++){JSONObject r=records.getJSONObject(n),o=r.getJSONObject("original");visible.put(r);labels.add(o.optString("title")+" · 旧作品 "+o.opt("observationId")+"\n"+r.getString("archiveId").substring(0,12)+":"+r.getInt("recordIndex")+" · "+statusLabel(r.getString("status"))+(r.getBoolean("conflict")?" · 冲突并存":"")+"\n"+o.optString("summary"));}labels.notifyDataSetChanged();}else graph.set(g);
    JSONObject c=CollectionQuality.object(index,"counts");counts.setText("文稿 "+c.optInt("documents")+" · 未准入 "+c.optInt("blocked")+" · 来源旧版 "+c.optInt("superseded")+"\n筛选范围关系全量 "+relations.length()+" · 文字筛选 "+g.getInt("filtered")+" · 本页 "+(table?visible.length():g.getInt("shown"))+" · 第 "+(page+1)+" 页/每页40\n旧记录 "+records.length()+"（未入历史图 "+projection.optInt("blocked")+"）；主题仅筛关系。虚线是未核验作者观点；同名端点不合并。双指缩放/拖动，点节点或边读版本。读取快照，更新后请重读。");
  }
  void reader(String title,String body){showReader(title,body,"creatorRelationsFullReader",null);}
  void showReader(String title,String body,String tag,Work action){
    if(!alive())return;readerReturn=screen;reading=true;readerAction=action;readerTitle.setText(title);fullText.setTag(tag);fullText.setText(body);fullScroll.scrollTo(0,0);
    toolsScroll.setVisibility(GONE);workspace.setVisibility(GONE);readerPane.setVisibility(VISIBLE);toolsButton.setVisibility(GONE);backButton.setText(readerReturn.equals("tools")?"返回档案操作":"返回关系图");evidenceOpen.setVisibility(action==null?GONE:VISIBLE);
  }
  void evidence(JSONObject item)throws Exception{
    JSONObject shown=new JSONObject(item.toString());boolean legacy=item.has("archiveId");String id=item.optString("documentId",CollectionQuality.object(item,"source").optString("id"));
    if(legacy){JSONArray batches=store.read().getJSONArray("batches");for(int i=0;i<batches.length();i++)if(batches.getJSONObject(i).getString("id").equals(item.getString("archiveId")))shown.put("originalFileUtf8",batches.getJSONObject(i).getString("sourceUtf8"));}
    else{JSONObject analysis=new JSONObject();JSONArray rows=source.read();for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).optString("id").equals(id)){JSONArray all=CollectionQuality.array(rows.getJSONObject(i),"creatorAnalyses");for(int n=0;n<all.length();n++)if(all.getJSONObject(n).optString("id").equals(item.optString("analysisId")))analysis=all.getJSONObject(n);}JSONArray edges=analysis.optJSONArray("relations");int n=item.optInt("edgeIndex",-1);CreatorArchive.need(analysis.optString("bodyHash").equals(item.optString("bodyHash"))&&edges!=null&&n>=0&&n<edges.length()&&CreatorArchive.hash(edges.getJSONObject(n)).equals(CreatorArchive.hash(item.getJSONObject("edge"))),"精确分析或引文已变化，请重读");shown.put("analysis",analysis);}
    evidenceOpen.setText(legacy?"打开本机当前文稿（内容可能已变）":"回原有精确分析");
    showReader("文稿 / 引文 / 精确版本 · 作者观点未核验",shown.toString(2),"creatorRelationsEvidence",id.isEmpty()?null:()->open.run(legacy?new JSONObject().put("id",id):item));
  }
  final class ClaimGraph extends View{
    JSONObject data=new JSONObject();final Paint paint=new Paint(3);float scale=1,panX,panY,lastX,lastY,startX,startY;boolean moved;final ScaleGestureDetector pinch;
    ClaimGraph(){super(owner);pinch=new ScaleGestureDetector(owner,new ScaleGestureDetector.SimpleOnScaleGestureListener(){public boolean onScale(ScaleGestureDetector d){moved=true;zoom(d.getScaleFactor());return true;}});}
    void set(JSONObject g){data=g;invalidate();}void reset(){scale=Math.max(.25f,Math.min(1,getWidth()/(getResources().getDisplayMetrics().density*720)));panX=dp(10);panY=dp(10);invalidate();}void zoom(float f){scale=Math.max(.25f,Math.min(4,scale*f));invalidate();}
    protected void onSizeChanged(int w,int h,int oldw,int oldh){reset();}
    void label(Canvas c,String s,float x,float y,int width,int color){TextPaint tp=new TextPaint(paint);tp.setColor(color);tp.setTextSize(14);StaticLayout layout=StaticLayout.Builder.obtain(s,0,s.length(),tp,width).setMaxLines(3).setEllipsize(TextUtils.TruncateAt.END).build();c.save();c.translate(x,y);layout.draw(c);c.restore();}
    protected void onDraw(Canvas c){super.onDraw(c);c.save();c.translate(panX,panY);float factor=scale*getResources().getDisplayMetrics().density;c.scale(factor,factor);
      try{JSONArray nodes=CollectionQuality.array(data,"nodes"),edges=CollectionQuality.array(data,"edges");for(int n=0;n<nodes.length();n++){JSONObject node=nodes.getJSONObject(n);float x=(float)node.getDouble("x"),y=(float)node.getDouble("y");paint.setColor(0xffdaeaf7);paint.setStyle(Paint.Style.FILL);c.drawRoundRect(x,y,x+160,y+55,6,6,paint);label(c,node.getString("label"),x+5,y+2,150,0xff16364c);}
        for(int n=0;n<edges.length();n++){JSONObject r=edges.getJSONObject(n).getJSONObject("evidence"),e=r.getJSONObject("edge"),s=r.getJSONObject("sourceSnapshot");float y=(float)edges.getJSONObject(n).getDouble("y");int color=e.getString("polarity").equals("contradicts")?0xffad6926:0xff267e9b;paint.setColor(color);paint.setStrokeWidth(3);paint.setPathEffect(new DashPathEffect(new float[]{8,5},0));c.drawLine(162,y+28,517,y+28,paint);paint.setPathEffect(null);label(c,e.getString("relation")+" → "+(e.getString("polarity").equals("contradicts")?"相反观点":"作者观点"),210,y,285,color);label(c,s.optString("channel")+" · "+s.optString("title")+"\n"+r.optString("documentId")+" · "+r.optString("analysisId"),0,y+58,690,0xff668399);}
      }catch(Exception e){counts.setText(e.getMessage());}c.restore();
    }
    public boolean onTouchEvent(android.view.MotionEvent e){if(!alive()||!isShown())return false;pinch.onTouchEvent(e);if(e.getActionMasked()==MotionEvent.ACTION_DOWN){startX=lastX=e.getX();startY=lastY=e.getY();moved=false;return true;}if(e.getActionMasked()==MotionEvent.ACTION_MOVE){if(Math.abs(e.getX()-startX)+Math.abs(e.getY()-startY)>dp(5))moved=true;if(!pinch.isInProgress()){panX+=e.getX()-lastX;panY+=e.getY()-lastY;invalidate();}lastX=e.getX();lastY=e.getY();return true;}if(e.getActionMasked()==MotionEvent.ACTION_UP&&!moved){float f=scale*getResources().getDisplayMetrics().density,x=(e.getX()-panX)/f,y=(e.getY()-panY)/f;safe(()->{JSONArray edges=CollectionQuality.array(data,"edges");for(int n=0;n<edges.length();n++){JSONObject edge=edges.getJSONObject(n);float row=(float)edge.getDouble("y");if(x>=0&&x<=690&&y>=row&&y<=row+105){evidence(edge.getJSONObject("evidence"));break;}}});performClick();return true;}return true;}
    public boolean performClick(){super.performClick();return true;}
  }
  /** Android's own document picker; callback dies with this page, never survives as authority. */
  public static final class CreatorArchivePicker extends Fragment{
    CreatorRelationsPanel target;long ticket;
    boolean returned,loading,loaded;Uri selected;byte[] bytes;String failure;
    public CreatorArchivePicker(){}
    static void launch(Activity owner,CreatorRelationsPanel panel){CreatorArchivePicker picker=new CreatorArchivePicker();picker.target=panel;picker.ticket=panel.epoch;owner.getFragmentManager().beginTransaction().add(picker,"creator-archive-picker-"+UUID.randomUUID()).commit();owner.getFragmentManager().executePendingTransactions();picker.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),1);}
    public void onActivityResult(int request,int result,Intent data){
      super.onActivityResult(request,result,data);if(request!=1||returned)return;
      returned=true;selected=result==Activity.RESULT_OK&&data!=null?data.getData():null;postDrain();
    }
    // Activity results arrive before MainActivity restores its foreground gate.
    // Keep only this fragment's in-memory result, then recheck the original page and epoch.
    public void onResume(){super.onResume();postDrain();}
    void postDrain(){Activity a=getActivity();if(a!=null)a.getWindow().getDecorView().post(this::drain);}
    void finish(){target=null;bytes=null;selected=null;Activity a=getActivity();if(a!=null&&isAdded())a.getFragmentManager().beginTransaction().remove(this).commitAllowingStateLoss();}
    void drain(){
      Activity a=getActivity();CreatorRelationsPanel panel=target;
      if(a==null||panel==null||panel.closed||panel.epoch!=ticket||!panel.isShown()||panel.reading||!panel.screen.equals("tools")){finish();return;}
      if(!returned||!panel.toolsActive())return;
      if(selected==null){panel.counts.setText("文件选择已取消，旧档案未修改");finish();return;}
      if(loaded){byte[] raw=bytes;String error=failure;finish();if(raw!=null)panel.previewBytes(raw);else panel.counts.setText(error);return;}
      if(loading)return;loading=true;Uri uri=selected;
      panel.worker.execute(()->{
        byte[] raw=null;String error=null;
        try(InputStream in=a.getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("旧文件不可读");raw=CreatorArchiveStore.readBounded(in,CreatorArchive.FILE_LIMIT);}catch(Exception e){error=e.getMessage();}
        final byte[] value=raw;final String problem=error;
        a.runOnUiThread(()->{if(target!=panel||panel.closed||panel.epoch!=ticket){finish();return;}bytes=value;failure=problem;loaded=true;drain();});
      });
    }
    public void onDestroy(){target=null;bytes=null;selected=null;super.onDestroy();}
  }
}

