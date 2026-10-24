package org.marketreview.nativeapp;
import android.content.Context;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import java.io.File;
import java.time.*;
import java.util.*;
import org.json.*;
public final class CffexDisclosureScreen extends LinearLayout {
 public interface Host {void fetch(String token,JSONObject request);default void cancel(String token){}}
 final Host host;final CffexDisclosureStore store;final HostCffexState reading;
 final CffexDisclosureUpdates updates=new CffexDisclosureUpdates();
 static final String[] SCOPES={"ALL","IF","IH","IC","IM"};
 JSONArray reports=new JSONArray();JSONObject totals;CffexDisclosureBatch batch;
 final List<JSONObject> contractRows=new ArrayList<>(),contractReports=new ArrayList<>();boolean detailsOpen;
 JSONObject archive,current,pending;String active="",statusText="按日期与品种读取；已确认2026休市日回看上一交易日。";boolean loading,original,dark;
 final EditText date;final Spinner product,history,contract;final Button saveButton,rawButton;
 final CheckBox notifyNew;
 final TextView status,summary,raw;final ScrollView reportScroll,rawScroll,controlsScroll;final LinearLayout report,controls;final FrameLayout body;final Button options;boolean compact,settingsOpen;
 public CffexDisclosureScreen(Context context,File file,Host source)throws Exception{
  super(context);setOrientation(VERTICAL);setSaveFromParentEnabled(false);host=source;store=new CffexDisclosureStore(file);reading=new HostCffexState(file);
  controlsScroll=new ScrollView(context);controls=new LinearLayout(context);controls.setOrientation(VERTICAL);controlsScroll.addView(controls);addView(controlsScroll,new LayoutParams(-1,-2));
  LinearLayout filter=new LinearLayout(context);controls.addView(filter,new LayoutParams(-1,dp(48)));date=new EditText(context);date.setTag("cffexDate");date.setSingleLine(true);date.setText(LocalDate.now(ZoneOffset.ofHours(8)).toString());date.setHint("YYYY-MM-DD");filter.addView(date,new LayoutParams(0,dp(48),1));button(filter,"日历","cffexCalendar",()->{LocalDate initial=TradingDaySelection.parse(date.getText().toString());if(initial==null)initial=LocalDate.now(ZoneOffset.ofHours(8));new android.app.DatePickerDialog(getContext(),(picker,y,m,d)->date.setText(LocalDate.of(y,m+1,d).toString()),initial.getYear(),initial.getMonthValue()-1,initial.getDayOfMonth()).show();});product=new Spinner(context);product.setAdapter(adapter(new String[]{"全部股指","IF","IH","IC","IM"}));filter.addView(product,new LayoutParams(dp(105),dp(48)));button(filter,"读取","cffexFetch",()->{try{begin(date.getText().toString(),SCOPES[product.getSelectedItemPosition()]);}catch(Exception e){notice(e.getMessage());}}).setEnabled(host!=null);
  LinearLayout actions=row();options=button(actions,"读取条件","cffexOptions",()->panel(!settingsOpen));options.setVisibility(GONE);button(actions,"取消读取","cffexCancel",()->{cancel();notice("已取消读取；未改动历史。");});saveButton=button(actions,"保存当前品种","cffexSave",()->saveCurrent());saveButton.setEnabled(false);rawButton=button(actions,"查看原文","cffexOriginal",this::openOriginal);
  history=new Spinner(context);history.setTag("cffexHistory");controls.addView(history,new LayoutParams(-1,dp(44)));contract=new Spinner(context);contract.setTag("cffexContract");controls.addView(contract,new LayoutParams(-1,dp(44)));
  notifyNew=new CheckBox(context);notifyNew.setTag("cffexNotifyNew");notifyNew.setText("新披露提醒（仅应用内）");notifyNew.setTextSize(13);notifyNew.setChecked(updates.enabled);notifyNew.setOnCheckedChangeListener((button,checked)->updates.enabled=checked);controls.addView(notifyNew,new LayoutParams(-1,dp(40)));
  body=new FrameLayout(context);addView(body,new LayoutParams(-1,0,1));reportScroll=new ScrollView(context);body.addView(reportScroll,new FrameLayout.LayoutParams(-1,-1));report=new LinearLayout(context);report.setOrientation(VERTICAL);reportScroll.addView(report);summary=new TextView(context);summary.setTextSize(13);summary.setPadding(6,4,6,6);
  rawScroll=new ScrollView(context);body.addView(rawScroll,new FrameLayout.LayoutParams(-1,-1));raw=new TextView(context);raw.setTextSize(13);raw.setTextIsSelectable(true);rawScroll.addView(raw);rawScroll.setVisibility(GONE);
  status=new TextView(context);status.setTag("cffexStatus");status.setTextSize(12);status.setMaxLines(3);addView(status);
  reload();history.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int i,long id){if(!loading&&i>0&&history.getSelectedItemPosition()==i)selectHistory(i);}});
  contract.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int i,long id){if(!loading)render();}});
  notice(statusText);setDarkTheme(false);
 }
 int dp(int x){return Math.round(x*getResources().getDisplayMetrics().density);}
 ArrayAdapter<String> adapter(String[] a){return new ArrayAdapter<String>(getContext(),android.R.layout.simple_spinner_item,a){
  {setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);}
  android.view.View color(android.view.View v){if(v instanceof TextView){((TextView)v).setTextSize(13);((TextView)v).setTextColor(dark?Color.rgb(221,231,243):Color.rgb(35,49,69));v.setBackgroundColor(dark?Color.rgb(17,25,39):Color.WHITE);}return v;}
  @Override public View getView(int p,View v,ViewGroup g){return color(super.getView(p,v,g));}
  @Override public View getDropDownView(int p,View v,ViewGroup g){return color(super.getDropDownView(p,v,g));}
 };}
 @Override protected void onSizeChanged(int w,int h,int ow,int oh){super.onSizeChanged(w,h,ow,oh);boolean next=getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;if(next!=compact){compact=next;post(()->panel(false));}}
 void panel(boolean open){settingsOpen=compact&&open;options.setVisibility(compact?VISIBLE:GONE);options.setText(settingsOpen?"返回榜单":"读取条件");controlsScroll.setVisibility(!compact||settingsOpen?VISIBLE:GONE);controlsScroll.setLayoutParams(settingsOpen?new LayoutParams(-1,0,1):new LayoutParams(-1,-2));body.setVisibility(settingsOpen?GONE:VISIBLE);}

 LinearLayout row(){LinearLayout r=new LinearLayout(getContext());r.setOrientation(HORIZONTAL);addView(r,new LayoutParams(-1,dp(48)));return r;}
 Button button(LinearLayout r,String text,String tag,Runnable click){Button b=new Button(getContext());b.setText(text);b.setTextSize(13);b.setPadding(2,0,2,0);b.setMinWidth(0);b.setTag(tag);b.setOnClickListener(v->click.run());r.addView(b,new LayoutParams(0,dp(48),1));return b;}
 void notice(String text){statusText=text==null?"操作未完成":text;status.setText(statusText);}
 void reload()throws Exception{loading=true;try{archive=store.read();JSONArray f=archive.getJSONArray("frames");String[] labels=new String[f.length()+1];labels[0]="选择已保存历史（只读）";for(int i=0;i<f.length();i++){JSONObject r=new JSONObject(f.getJSONObject(i).getString("json")),q=r.getJSONObject("request");updates.remember(r);labels[i+1]=q.getString("date")+" / "+q.getString("product")+" / "+r.getString("checkedAt");}history.setAdapter(adapter(labels));}finally{loading=false;}}
 public String activeToken(){return active;}
 public String begin(String day,String scope)throws Exception{
  LocalDate chosen=TradingDaySelection.parse(day);String effective=chosen==null?day:TradingDaySelection.effective(chosen).toString();
  CffexDisclosureBatch next=new CffexDisclosureBatch(effective,scope);CffexDisclosureModel.need(host!=null,"尚未接入读取来源");
  cancel();date.setText(day);product.setSelection(Arrays.asList(SCOPES).indexOf(scope));panel(false);batch=next;return requestNext();
 }
 String requestNext()throws Exception{
  pending=batch.request();active=UUID.randomUUID().toString();String token=active;
  notice("读取 "+batch.date+" / "+pending.getString("product")+"（"+(batch.received()+1)+"/"+batch.required()+"）；各品种最多15秒，本批全部成功才更新。");
  try{host.fetch(token,pending);}catch(RuntimeException e){fail(token,e.getMessage());throw e;}return token;
 }
 public boolean accept(String token,JSONObject r){
  if(active.isEmpty()||!active.equals(token)||batch==null)return false;
  try{
   batch.accept(r);
   if(!batch.complete()){active="";pending=null;requestNext();return true;}
   JSONArray next=batch.result();JSONObject nextTotals=CffexPositionSummary.dailyTotals(next);
   reports=next;totals=nextTotals;current=reports.getJSONObject(0);active="";pending=null;batch=null;detailsOpen=false;setContracts();back();
   boolean fresh=updates.acceptReports(reports);String received=totals.getString("date")+" / "+scopeText();
   notice((fresh?"新披露已取得 · ":"读取成功 · ")+received+"；保存按钮仅保存当前单品种原文。");
   if(fresh&&isShown())Toast.makeText(getContext(),"新披露已取得："+received,Toast.LENGTH_LONG).show();return true;
  }catch(Exception e){fail(token,e.getMessage());return false;}
 }
 public void fail(String token,String reason){if(active.isEmpty()||!active.equals(token))return;cancel();notice("本批读取失败："+reason+"；未更新总摘要，仍保留上次完整读取/历史。");}
 public void cancel(){String token=active;active="";pending=null;if(batch!=null)batch.cancel();batch=null;if(!token.isEmpty()&&host!=null)host.cancel(token);}
 @Override protected void onDetachedFromWindow(){cancel();super.onDetachedFromWindow();}
 public boolean saveCurrent(){if(current==null||!saveButton.isEnabled())return false;try{store.save(current,archive.getLong("revision"));reload();saveButton.setEnabled(false);notice("仅保存 "+current.getJSONObject("request").getString("product")+" 单品种原文；未将四品种批次保存为完整历史。");return true;}catch(Exception e){notice(e.getMessage());return false;}}
 public boolean selectHistory(int index){
  try{JSONArray frames=archive.getJSONArray("frames");if(index<1||index>frames.length())return false;
   JSONObject selected=CffexDisclosureModel.validate(new JSONObject(frames.getJSONObject(index-1).getString("json")));
   JSONArray next=new JSONArray().put(selected);JSONObject nextTotals=CffexPositionSummary.dailyTotals(next);cancel();
   reports=next;totals=nextTotals;current=selected;updates.rememberReports(reports);date.setText(totals.getString("date"));
   product.setSelection(Arrays.asList(SCOPES).indexOf(current.getJSONObject("request").getString("product")));
   detailsOpen=false;setContracts();saveButton.setEnabled(false);panel(false);back();notice("单品种历史只读 · "+scopeText()+" · "+current.getString("checkedAt"));return true;
  }catch(Exception e){notice(e.getMessage());return false;}
 }
 void setContracts()throws Exception{
  loading=true;try{contractRows.clear();contractReports.clear();List<String> labels=new ArrayList<>();
   for(int n=0;n<reports.length();n++){JSONObject source=reports.getJSONObject(n);JSONArray cs=source.getJSONArray("contracts");
    for(int i=0;i<cs.length();i++){JSONObject c=cs.getJSONObject(i);contractRows.add(c);contractReports.add(source);labels.add(c.getString("contract")+" / "+source.getJSONObject("request").getString("date"));}}
   contract.setAdapter(adapter(labels.toArray(new String[0])));
  }finally{loading=false;}render();
 }
 boolean savedCurrent(){if(current==null)return true;String text=current.toString();JSONArray frames=archive.optJSONArray("frames");for(int i=0;frames!=null&&i<frames.length();i++)if(text.equals(frames.optJSONObject(i).optString("json")))return true;return false;}
 String scopeText(){return totals.optBoolean("allProducts")?"全部股指 IF/IH/IC/IM · 4/4品种":"单品种 "+totals.optJSONArray("products").optString(0)+" · 1/4品种（非四品种合计）";}
 String number(JSONObject o,String k)throws Exception{return o.isNull(k)?"未知":String.format(Locale.ROOT,"%.0f",o.getDouble(k));}
 void render(){if(totals==null||contractRows.isEmpty())return;try{
  int index=Math.max(0,Math.min(contract.getSelectedItemPosition(),contractRows.size()-1));JSONObject c=contractRows.get(index);current=contractReports.get(index);
  saveButton.setEnabled(!savedCurrent());report.removeAllViews();
  heading(report,"披露日 "+totals.getString("date")+" · 当日净变化",18,true);
  dailyCard("中信期货",totals.getJSONObject("citic"),true);
  dailyCard("全部已披露机构（各合约前20席位）",totals.getJSONObject("institutions"),false);
  Button detail=new Button(getContext());detail.setText(detailsOpen?"收起合约明细":"查看合约明细");detail.setTag("cffexDetails");detail.setOnClickListener(v->{detailsOpen=!detailsOpen;render();});report.addView(detail,new LayoutParams(-1,dp(44)));
  raw.setText("当前单品种原文："+current.getJSONObject("request").getString("product")+"\n来源："+current.getString("sourceUrl")+"\n接收："+current.getString("checkedAt")+"\nSHA256："+current.getString("rawSha256")+"\n交易日历及合约挂牌未独立核验。\n\n"+current.getString("rawXml"));
  if(detailsOpen){
   heading(report,c.getString("contract")+" · 合约明细（不改变顶部批次汇总）",16,true);
   report.addView(summary);summary.setText("榜内多头 "+number(c,"listedLong")+"  空头 "+number(c,"listedShort")+"  差额 "+number(c,"listedDifference")+" 手\n两侧排名会员可能不同；不是资金净流入。\n来源 "+(current.getString("origin").equals("host-fetch-response")?"CFFEX响应（未独立核验）":"构造/导入材料，非实盘")+" · "+current.getString("checkedAt"));
   JSONArray members=CffexPositionSummary.contract(c).getJSONArray("members");for(int i=0;i<members.length();i++)position(members.getJSONObject(i));
   heading(report,"原始披露排名 · 手",15,true);line("类别/名次","会员","持仓/成交","增减",true);
   JSONArray rows=c.getJSONArray("rows");for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);String side=r.getString("type");line((side.equals("long")?"多头":side.equals("short")?"空头":"成交")+" "+r.getInt("rank"),r.getString("member"),number(r,"volume"),number(r,"change"),false);}
  }
  theme(this);
 }catch(Exception e){notice(e.getMessage());}}
 void dailyCard(String label,JSONObject values,boolean citic)throws Exception{
  LinearLayout card=new LinearLayout(getContext());card.setOrientation(VERTICAL);card.setTag(citic?"cffexCiticCard":"cffexMemberCard");card.setPadding(dp(6),dp(6),dp(6),dp(6));
  LayoutParams params=new LayoutParams(-1,-2);params.setMargins(dp(4),dp(4),dp(4),dp(4));report.addView(card,params);
  heading(card,label+" · "+totals.getString("date"),16,true);netHeading(card,values,28);
  heading(card,"多单增减 "+changeNumber(values,"longChange")+" / 空单增减 "+changeNumber(values,"shortChange")+" 手",13,false);
  heading(card,scopeText()+"\n"+(citic?"可比":"变化完整")+"合约 "+values.getInt("covered")+"/"+values.getInt("total")+" · "+(citic?"仅同会员双边可比合约，缺项不补零。":"各合约前20披露席位可重复，不是全市场。"),12,false);
  boolean real=true;for(int i=0;i<reports.length();i++)real&=reports.getJSONObject(i).optString("origin").equals("host-fetch-response");
  if(!real)heading(card,"构造/导入材料，非本次真实获取",12,false);
 }
 String changeNumber(JSONObject values,String key){return values.isNull(key)?"未知":String.format(Locale.ROOT,"%+.0f",values.optDouble(key));}
 TextView heading(LinearLayout parent,String text,int size,boolean bold){TextView t=new TextView(getContext());t.setText(text);t.setTextSize(size);t.setPadding(dp(8),dp(5),dp(8),dp(5));if(bold)t.setTypeface(null,1);parent.addView(t,new LayoutParams(-1,-2));return t;}
 void netHeading(LinearLayout parent,JSONObject values,int size){TextView change=heading(parent,CffexPositionSummary.changeText(values),size,true);change.setTag(values.isNull("netChange")?"cffexNetUnknown":values.optDouble("netChange")>0?"cffexNetLong":values.optDouble("netChange")<0?"cffexNetShort":"cffexNetZero");}
 void position(JSONObject member)throws Exception{LinearLayout card=new LinearLayout(getContext());card.setOrientation(VERTICAL);card.setPadding(0,dp(4),0,dp(4));card.setTag(member.getBoolean("citic")?"cffexCiticCard":"cffexMemberCard");LayoutParams params=new LayoutParams(-1,-2);params.setMargins(dp(4),dp(3),dp(4),dp(3));report.addView(card,params);heading(card,member.getString("member"),15,true);netHeading(card,member,18);heading(card,"日终"+CffexPositionSummary.netText(member),12,false);heading(card,"多头 "+number(member,"long")+" / 空头 "+number(member,"short")+" 手\n多头增减 "+number(member,"longChange")+" / 空头增减 "+number(member,"shortChange")+" 手",12,false);if(member.isNull("net")||member.isNull("netChange"))heading(card,member.optString("reason","该会员披露不完整，未知项不能补零。"),12,false);}
 void line(String a,String b,String c,String d,boolean header){LinearLayout r=new LinearLayout(getContext());r.setPadding(3,5,3,5);String[] text={a,b,c,d};float[] weights={1,2,1.1f,.8f};for(int i=0;i<4;i++){TextView t=new TextView(getContext());t.setText(text[i]);t.setTextSize(13);if(i>1)t.setGravity(Gravity.END);if(header)t.setTypeface(null,1);r.addView(t,new LayoutParams(0,-2,weights[i]));}report.addView(r);}
 public void openOriginal(){if(current==null)return;panel(false);original=true;reportScroll.setVisibility(GONE);rawScroll.setVisibility(VISIBLE);rawButton.setText("返回榜单");rawButton.setOnClickListener(v->back());}
 public boolean back(){if(settingsOpen){panel(false);return true;}if(!original)return false;original=false;reportScroll.setVisibility(VISIBLE);rawScroll.setVisibility(GONE);rawButton.setText("查看原文");rawButton.setOnClickListener(v->openOriginal());return true;}
 public JSONObject saveState()throws Exception{
  JSONObject s=new JSONObject().put("schema","cffex-reading/v1").put("date",date.getText().toString()).put("product",SCOPES[product.getSelectedItemPosition()]).put("contract",contract.getSelectedItemPosition()).put("original",original).put("detailsOpen",detailsOpen).put("scroll",original?rawScroll.getScrollY():reportScroll.getScrollY()).put("status",statusText).put("seenDisclosures",updates.saved()).put("notifyNew",updates.enabled);
  if(reports.length()>0)s.put("reports",reports);return reading.save(s);
 }
 public void restoreState(JSONObject marker)throws Exception{
  JSONObject s=reading.read(marker);cancel();updates.restore(s.optJSONArray("seenDisclosures"));notifyNew.setChecked(s.optBoolean("notifyNew",true));date.setText(s.optString("date"));
  int scope=Arrays.asList(SCOPES).indexOf(s.optString("product"));product.setSelection(Math.max(0,scope));
  reports=s.optJSONArray("reports");if(reports==null){reports=new JSONArray();if(s.optJSONObject("report")!=null)reports.put(s.getJSONObject("report"));}
  detailsOpen=s.optBoolean("detailsOpen");totals=reports.length()>0?CffexPositionSummary.dailyTotals(reports):null;current=reports.length()>0?reports.getJSONObject(0):null;
  if(current!=null){updates.rememberReports(reports);setContracts();contract.setSelection(Math.max(0,Math.min(s.optInt("contract"),contract.getCount()-1)));render();if(s.optBoolean("original"))openOriginal();else back();ScrollView target=original?rawScroll:reportScroll;target.post(()->target.scrollTo(0,s.optInt("scroll")));}
  notice("恢复阅读；未恢复在途批次，未检查新披露。");
 }
 public void setDarkTheme(boolean value){dark=value;setBackgroundColor(dark?Color.rgb(17,25,39):Color.WHITE);theme(this);}
 void theme(View v){String tag=String.valueOf(v.getTag());if(v instanceof TextView){int color=dark?Color.rgb(221,231,243):Color.rgb(35,49,69);if(tag.equals("cffexNetLong"))color=dark?0xffff8792:0xffbd253c;else if(tag.equals("cffexNetShort"))color=dark?0xff71d3af:0xff087a57;((TextView)v).setTextColor(color);}if(tag.equals("cffexCiticCard"))v.setBackgroundColor(dark?0xff243b53:0xffe7f1fb);else if(tag.equals("cffexMemberCard"))v.setBackgroundColor(dark?0xff192638:0xfff3f6f9);if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)theme(((ViewGroup)v).getChildAt(i));}
}
