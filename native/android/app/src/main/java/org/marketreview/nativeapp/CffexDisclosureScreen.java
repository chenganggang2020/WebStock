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
 JSONObject archive,current,pending;String active="",statusText="按日期与品种读取；不自动查询其他交易日。";boolean loading,original,dark;
 final EditText date;final Spinner product,history,contract;final Button saveButton,rawButton;
 final TextView status,summary,raw;final ScrollView reportScroll,rawScroll,controlsScroll;final LinearLayout report,controls;final FrameLayout body;final Button options;boolean compact,settingsOpen;
 public CffexDisclosureScreen(Context context,File file,Host source)throws Exception{
  super(context);setOrientation(VERTICAL);setSaveFromParentEnabled(false);host=source;store=new CffexDisclosureStore(file);reading=new HostCffexState(file);
  controlsScroll=new ScrollView(context);controls=new LinearLayout(context);controls.setOrientation(VERTICAL);controlsScroll.addView(controls);addView(controlsScroll,new LayoutParams(-1,-2));
  LinearLayout filter=new LinearLayout(context);controls.addView(filter,new LayoutParams(-1,dp(48)));date=new EditText(context);date.setTag("cffexDate");date.setSingleLine(true);date.setText(LocalDate.now(ZoneOffset.ofHours(8)).toString());date.setHint("YYYY-MM-DD");filter.addView(date,new LayoutParams(0,dp(48),1));product=new Spinner(context);product.setAdapter(adapter(new String[]{"IF","IH","IC","IM"}));filter.addView(product,new LayoutParams(dp(90),dp(48)));button(filter,"读取","cffexFetch",()->{try{begin(date.getText().toString(),product.getSelectedItem().toString());}catch(Exception e){notice(e.getMessage());}}).setEnabled(host!=null);
  LinearLayout actions=row();options=button(actions,"读取条件","cffexOptions",()->panel(!settingsOpen));options.setVisibility(GONE);button(actions,"取消读取","cffexCancel",()->{cancel();notice("已取消读取；未改动历史。");});saveButton=button(actions,"保存原文","cffexSave",()->saveCurrent());saveButton.setEnabled(false);rawButton=button(actions,"查看原文","cffexOriginal",this::openOriginal);
  history=new Spinner(context);history.setTag("cffexHistory");controls.addView(history,new LayoutParams(-1,dp(44)));contract=new Spinner(context);contract.setTag("cffexContract");controls.addView(contract,new LayoutParams(-1,dp(44)));
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
 void reload()throws Exception{loading=true;try{archive=store.read();JSONArray f=archive.getJSONArray("frames");String[] labels=new String[f.length()+1];labels[0]="选择已保存历史（只读）";for(int i=0;i<f.length();i++){JSONObject r=new JSONObject(f.getJSONObject(i).getString("json")),q=r.getJSONObject("request");labels[i+1]=q.getString("date")+" / "+q.getString("product")+" / "+r.getString("checkedAt");}history.setAdapter(adapter(labels));}finally{loading=false;}}
 public String activeToken(){return active;}
 public String begin(String day,String p)throws Exception{
  JSONObject q=CffexDisclosureModel.request(day,p);CffexDisclosureModel.need(host!=null,"尚未接入读取来源");cancel();panel(false);pending=q;active=UUID.randomUUID().toString();String token=active;notice("读取 "+day+" / "+p+"；最多15秒，不重试。");try{host.fetch(token,q);}catch(RuntimeException e){fail(token,e.getMessage());throw e;}return token;
 }
 public boolean accept(String token,JSONObject r){if(active.isEmpty()||!active.equals(token))return false;try{JSONObject safe=CffexDisclosureModel.validate(r);CffexDisclosureModel.need(CffexDisclosureModel.equal(safe.getJSONObject("request"),pending),"响应不属于指定日期和品种");active="";pending=null;current=safe;setContracts();saveButton.setEnabled(true);back();notice("读取成功 · 尚未保存；只含已披露排名席位。");return true;}catch(Exception e){fail(token,e.getMessage());return false;}}
 public void fail(String token,String reason){if(active.isEmpty()||!active.equals(token))return;active="";pending=null;notice("读取失败："+reason+"；旧历史保留。");}
 public void cancel(){String token=active;active="";pending=null;if(!token.isEmpty()&&host!=null)host.cancel(token);}
 @Override protected void onDetachedFromWindow(){cancel();super.onDetachedFromWindow();}
 public boolean saveCurrent(){if(current==null||!saveButton.isEnabled())return false;try{store.save(current,archive.getLong("revision"));reload();saveButton.setEnabled(false);notice("原文已保存；独立历史库，未修改旧业务库。");return true;}catch(Exception e){notice(e.getMessage());return false;}}
 public boolean selectHistory(int index){try{JSONArray frames=archive.getJSONArray("frames");if(index<1||index>frames.length())return false;cancel();current=CffexDisclosureModel.validate(new JSONObject(frames.getJSONObject(index-1).getString("json")));setContracts();saveButton.setEnabled(false);panel(false);back();notice("历史只读 · "+current.getString("checkedAt"));return true;}catch(Exception e){notice(e.getMessage());return false;}}
 void setContracts()throws Exception{loading=true;try{JSONArray cs=current.getJSONArray("contracts");String[] labels=new String[cs.length()];for(int i=0;i<cs.length();i++)labels[i]=cs.getJSONObject(i).getString("contract")+" / "+current.getJSONObject("request").getString("date");contract.setAdapter(adapter(labels));}finally{loading=false;}render();}
 String number(JSONObject o,String k)throws Exception{return o.isNull(k)?"未知":String.format(Locale.ROOT,"%.0f",o.getDouble(k));}
 void render(){if(current==null)return;try{
  JSONObject c=current.getJSONArray("contracts").getJSONObject(Math.max(0,contract.getSelectedItemPosition()));report.removeAllViews();report.addView(summary);summary.setText("披露多头 "+number(c,"listedLong")+"  空头 "+number(c,"listedShort")+"  差额 "+number(c,"listedDifference")+" 手\n仅榜内席位，不是全市场净流入。缺项为未知。\n来源 "+(current.getString("origin").equals("host-fetch-response")?"CFFEX响应（未独立核验）":"构造/导入材料，非实盘")+" · "+current.getString("checkedAt"));
  line("类别/名次","会员","持仓/成交","增减",true);JSONArray rows=c.getJSONArray("rows");for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);String side=r.getString("type");line((side.equals("long")?"多头":side.equals("short")?"空头":"成交")+" "+r.getInt("rank"),r.getString("member"),number(r,"volume"),number(r,"change"),false);}raw.setText("来源："+current.getString("sourceUrl")+"\n接收："+current.getString("checkedAt")+"\nSHA256："+current.getString("rawSha256")+"\n交易日历及合约挂牌未独立核验。\n\n"+current.getString("rawXml"));theme(this);
 }catch(Exception e){notice(e.getMessage());}}
 void line(String a,String b,String c,String d,boolean header){LinearLayout r=new LinearLayout(getContext());r.setPadding(3,5,3,5);String[] text={a,b,c,d};float[] weights={1,2,1.1f,.8f};for(int i=0;i<4;i++){TextView t=new TextView(getContext());t.setText(text[i]);t.setTextSize(13);if(i>1)t.setGravity(Gravity.END);if(header)t.setTypeface(null,1);r.addView(t,new LayoutParams(0,-2,weights[i]));}report.addView(r);}
 public void openOriginal(){if(current==null)return;panel(false);original=true;reportScroll.setVisibility(GONE);rawScroll.setVisibility(VISIBLE);rawButton.setText("返回榜单");rawButton.setOnClickListener(v->back());}
 public boolean back(){if(settingsOpen){panel(false);return true;}if(!original)return false;original=false;reportScroll.setVisibility(VISIBLE);rawScroll.setVisibility(GONE);rawButton.setText("查看原文");rawButton.setOnClickListener(v->openOriginal());return true;}
 public JSONObject saveState()throws Exception{
  JSONObject s=new JSONObject().put("schema","cffex-reading/v1").put("date",date.getText().toString()).put("product",product.getSelectedItem().toString()).put("contract",contract.getSelectedItemPosition()).put("original",original).put("scroll",original?rawScroll.getScrollY():reportScroll.getScrollY()).put("unsaved",saveButton.isEnabled()).put("status",statusText);if(current!=null)s.put("report",current);return reading.save(s);
 }
 public void restoreState(JSONObject marker)throws Exception{
  JSONObject s=reading.read(marker);cancel();date.setText(s.optString("date"));String p=s.optString("product");product.setSelection(Arrays.asList("IF","IH","IC","IM").indexOf(p));if(s.optJSONObject("report")!=null){current=CffexDisclosureModel.validate(s.getJSONObject("report"));setContracts();contract.setSelection(Math.max(0,Math.min(s.optInt("contract"),contract.getCount()-1)));saveButton.setEnabled(s.optBoolean("unsaved"));if(s.optBoolean("original"))openOriginal();else back();ScrollView target=original?rawScroll:reportScroll;target.post(()->target.scrollTo(0,s.optInt("scroll")));}notice(s.optString("status")+"（恢复阅读；未恢复在途请求）");
 }
 public void setDarkTheme(boolean value){dark=value;setBackgroundColor(dark?Color.rgb(17,25,39):Color.WHITE);theme(this);}
 void theme(View v){if(v instanceof TextView)((TextView)v).setTextColor(dark?Color.rgb(221,231,243):Color.rgb(35,49,69));if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)theme(((ViewGroup)v).getChildAt(i));}
}
