package org.marketreview.nativeapp;
import android.content.Context;
import android.os.Bundle;
import android.widget.*;
import android.view.*;
import android.text.*;
import org.json.*;
import java.util.*;
public final class PaperMonitorHostScreen extends LinearLayout {
 public interface AutomationHost{JSONObject preferences()throws Exception;void refresh(JSONArray ids)throws Exception;}
 private AutomationHost automationHost;private PaperAutomationScreen automation;
 public void setAutomationHost(AutomationHost host){automationHost=host;}
 private final PaperMonitorFlow flow;private final LinearLayout main,controls;private final ScrollView controlsScroll,readerScroll;private final Spinner accounts,history;private CheckBox scope,decisionAck;
 private EditText response;private TextView reader,status;private Button confirm,reject;private View settings;private boolean filling=false,restoringSelection=false,responseDirty=false;
 private final List<String> ids=new ArrayList<>();private final Runnable saveDraft=()->guard(this::flushResponse);
 private interface Checked{void run()throws Exception;}
 public PaperMonitorHostScreen(Context c,PaperMonitorFlow flow)throws Exception{
  super(c);this.flow=flow;setOrientation(VERTICAL);setSaveEnabled(false);main=new LinearLayout(c);main.setOrientation(VERTICAL);addView(main,new LayoutParams(-1,-1));
  controlsScroll=new ScrollView(c);controls=new LinearLayout(c);controls.setOrientation(VERTICAL);controlsScroll.addView(controls);main.addView(controlsScroll,new LayoutParams(-1,0,3));
  TextView note=new TextView(c);note.setText("人工纸面监控 · 仅本机已持有范围。确认只归档纸面决定。");controls.addView(note);
  accounts=new Spinner(c);accounts.setSaveEnabled(false);controls.addView(accounts);LinearLayout selection=row();button(selection,"重读账户",()->{flushResponse();flow.cancel();refreshAccounts();render();});button(selection,"账户策略设置",this::showSettings);
  button(controls,"自动监控 / 模拟成交",this::showAutomation).setTag("paperHostAutomation");
  scope=new CheckBox(c);scope.setText("我已核对本次纸面账户、现金及本机持仓范围");scope.setSaveEnabled(false);controls.addView(scope);
  LinearLayout actions=row();button(actions,"检查并准备",()->{flushResponse();flow.prepare(scope.isChecked());decisionAck.setChecked(false);render();reader.setText(flow.state().getString("prompt"));});
  button(actions,"证据 / 提示词",()->reader.setText(flow.state().getString("prompt")));button(actions,"预览人工答复",()->{flushResponse();flow.preview();decisionAck.setChecked(false);render();});
  response=new EditText(c);response.setSaveEnabled(false);response.setHint("人工六字段JSON答复");response.setMinLines(2);response.setMaxLines(4);controls.addView(response);
  decisionAck=new CheckBox(c);decisionAck.setSaveEnabled(false);decisionAck.setText("我已阅读预览，明确确认 / 拒绝归档；不会执行交易");controls.addView(decisionAck);
  LinearLayout decisions=row();confirm=button(decisions,"确认并归档",()->choose("confirmed"));reject=button(decisions,"拒绝并归档",()->choose("rejected"));button(decisions,"取消准备",()->{flushResponse();flow.cancel();decisionAck.setChecked(false);render();status.setText("准备已取消，全文草稿保留。");});
  history=new Spinner(c);history.setSaveEnabled(false);controls.addView(history);status=new TextView(c);controls.addView(status);readerScroll=new ScrollView(c);reader=new TextView(c);reader.setTextIsSelectable(true);reader.setSaveEnabled(false);readerScroll.addView(reader);main.addView(readerScroll,new LayoutParams(-1,0,2));arrange();
  response.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int st,int count,int after){}public void afterTextChanged(Editable e){}public void onTextChanged(CharSequence s,int st,int before,int count){if(!filling){responseDirty=true;confirm.setEnabled(false);reject.setEnabled(false);decisionAck.setChecked(false);removeCallbacks(saveDraft);postDelayed(saveDraft,300);}}});
  scope.setOnCheckedChangeListener((b,v)->{if(!filling)guard(()->{flushResponse();flow.cancel();render();});});
  accounts.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?>p){}public void onItemSelected(AdapterView<?>p,View v,int index,long id){if(!restoringSelection&&index>=0&&index<ids.size()&&accounts.getSelectedItemPosition()==index)guard(()->{if(ids.get(index).equals(flow.state().getString("accountId")))return;flushResponse();flow.selectAccount(ids.get(index));filling=true;scope.setChecked(false);filling=false;decisionAck.setChecked(false);render();});}});
  history.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?>p){}public void onItemSelected(AdapterView<?>p,View v,int index,long id){if(!filling&&index>0)guard(()->{flushResponse();flow.selectHistory(index-1);render();status.setText("历史只读，不能用旧输入再次确认。");});}});
  refreshAccounts();render();
 }
 private LinearLayout row(){LinearLayout r=new LinearLayout(getContext());controls.addView(r);return r;}
 private Button button(LinearLayout parent,String label,Checked action){Button b=new Button(getContext());b.setText(label);b.setTextSize(12);parent.addView(b,parent.getOrientation()==VERTICAL?new LayoutParams(-1,-2):new LayoutParams(0,-2,1));b.setOnClickListener(v->{if(b.isShown()&&hasWindowFocus())guard(action);});return b;}
 private void arrange(){boolean wide=getResources().getConfiguration().orientation==android.content.res.Configuration.ORIENTATION_LANDSCAPE;main.setOrientation(wide?HORIZONTAL:VERTICAL);controlsScroll.setLayoutParams(wide?new LayoutParams(0,-1,1):new LayoutParams(-1,0,3));readerScroll.setLayoutParams(wide?new LayoutParams(0,-1,1):new LayoutParams(-1,0,2));}
 @Override protected void onConfigurationChanged(android.content.res.Configuration c){super.onConfigurationChanged(c);if(readerScroll!=null)arrange();}
 private void guard(Checked c){try{c.run();}catch(Exception e){confirm.setEnabled(false);reject.setEnabled(false);status.setText("已阻断："+e.getMessage()+"；原业务数据保留。");}}
 private void flushResponse()throws Exception{removeCallbacks(saveDraft);JSONObject s=flow.state();if(!s.getString("accountId").isEmpty()&&!s.getString("response").equals(response.getText().toString()))flow.setResponse(response.getText().toString());if(s.getBoolean("writable"))responseDirty=false;}
 private void refreshAccounts()throws Exception{
  restoringSelection=true;ids.clear();ids.add("");List<String>labels=new ArrayList<>();labels.add("请选择纸面账户");JSONArray rows=flow.accounts();
  for(int i=0;i<rows.length();i++){JSONObject a=rows.getJSONObject(i);ids.add(a.getString("id"));labels.add(a.getString("name")+" ("+a.getString("id")+")");}
  accounts.setAdapter(new ArrayAdapter<String>(getContext(),android.R.layout.simple_spinner_dropdown_item,labels));accounts.setSelection(Math.max(0,ids.indexOf(flow.state().getString("accountId"))));restoringSelection=false;
 }
 private void render()throws Exception{
  JSONObject s=flow.state();filling=true;if(!responseDirty)response.setText(s.getString("response"));confirm.setEnabled(!responseDirty&&s.getBoolean("canConfirm"));reject.setEnabled(!responseDirty&&s.getBoolean("canReject"));
  JSONArray rows=flow.history();List<String>labels=new ArrayList<>();labels.add("纸面历史（只读）");for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);labels.add(r.getString("recordedAt")+" / "+r.getString("choice"));}
  history.setAdapter(new ArrayAdapter<String>(getContext(),android.R.layout.simple_spinner_dropdown_item,labels));history.setSelection(0);filling=false;
  JSONObject result=s.getJSONObject("result");reader.setText(result.length()==0?s.getString("prompt"):result.toString(2));
  String until="";JSONObject input=s.getJSONObject("evidence").optJSONObject("input");if(input!=null)until=input.getJSONObject("hostEvidence").getJSONObject("session").optString("validBefore");
  status.setText("所选账户："+s.getString("accountId")+"；"+(s.getBoolean("preparedForCurrentSession")?"本次准备有效，确认前将重新读取。":"留存证据只读，请重新准备。")+(until.isEmpty()?"":"证据会话截至 "+until));
  if(responseDirty||!s.getBoolean("writable"))status.setText("答复尚未成功保存，当前文字保留在内存；旧草稿未覆盖。请缩短过长答复或核对保存冲突。");
  response.setEnabled(!s.getString("accountId").isEmpty()&&s.getBoolean("active")&&s.getBoolean("writable"));
 }
 private void choose(String choice)throws Exception{flushResponse();flow.decide(choice,decisionAck.isChecked());decisionAck.setChecked(false);render();status.setText("纸面决定已归档；未写入订单、现金或持仓。");}
 private void showSettings()throws Exception{
  flushResponse();flow.cancel();if(settings!=null)removeView(settings);LinearLayout panel=new LinearLayout(getContext());panel.setOrientation(VERTICAL);button(panel,"返回纸面监控",()->back());
  panel.addView(new PaperPolicyScreen(getContext(),flow.settingsFile(),new PaperPolicyScreen.Host(){public JSONObject account()throws Exception{return flow.currentAccount();}public String now(){return flow.now();}}),new LayoutParams(-1,0,1));settings=panel;addView(panel,new LayoutParams(-1,-1));main.setVisibility(GONE);
 }
 private void showAutomation()throws Exception{flushResponse();flow.cancel();String id=flow.state().getString("accountId");if(id.isEmpty())throw new Exception("请先选择现有纸面账户并配置策略");if(automation!=null){automation.setActive(false);removeView(automation);}automation=new PaperAutomationScreen(getContext(),flow.automationFile(),id,new PaperAutomationRuntime.Host(){public JSONObject snapshot()throws Exception{return flow.automationSnapshot();}public JSONObject preferences()throws Exception{return automationHost==null?new JSONObject():automationHost.preferences();}public String now(){return flow.now();}public void refresh(JSONArray ids)throws Exception{if(automationHost!=null)automationHost.refresh(ids);}});automation.back=()->back();addView(automation,new LayoutParams(-1,-1));main.setVisibility(GONE);automation.setActive(hasWindowFocus());}
 public boolean back(){if(automation!=null&&automation.getVisibility()==VISIBLE){automation.setActive(false);removeView(automation);automation=null;main.setVisibility(VISIBLE);guard(this::render);return true;}if(settings!=null&&settings.getVisibility()==VISIBLE){guard(()->{flow.cancel();settings.setVisibility(GONE);main.setVisibility(VISIBLE);filling=true;scope.setChecked(false);filling=false;render();});return true;}return false;}
 public void setActive(boolean value){if(automation!=null)automation.setActive(value&&automation.isShown());if(!value){guard(this::flushResponse);guard(()->flow.setActive(false));filling=true;scope.setChecked(false);filling=false;decisionAck.setChecked(false);guard(this::render);}else guard(()->{flow.setActive(true);render();});}
 public Bundle saveState(){Bundle out=new Bundle();guard(()->{flushResponse();JSONObject m=flow.marker();out.putString("id",m.getString("id"));out.putString("hash",m.getString("hash"));});return out;}
 public void restoreState(Bundle b){if(b!=null)guard(()->{flow.restore(new JSONObject().put("id",b.getString("id")).put("hash",b.getString("hash")));refreshAccounts();render();});}
 @Override protected void onDetachedFromWindow(){removeCallbacks(saveDraft);setActive(false);super.onDetachedFromWindow();}
 @Override protected void onVisibilityChanged(View changed,int visibility){super.onVisibilityChanged(changed,visibility);if(visibility!=VISIBLE&&flow!=null&&reader!=null)setActive(false);}
 public void setDarkTheme(boolean dark){paint(this,dark);}
 private void paint(View v,boolean dark){if(v instanceof TextView)((TextView)v).setTextColor(dark?0xfff1f5fa:0xff172334);if(v instanceof EditText)v.setBackgroundTintList(android.content.res.ColorStateList.valueOf(dark?0xff8398b5:0xff537298));if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++)paint(g.getChildAt(i),dark);}setBackgroundColor(dark?0xff172334:0xfffafcff);}
}
