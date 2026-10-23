package org.marketreview.nativeapp;
import android.content.Context;
import android.graphics.*;
import android.view.*;
import org.json.*;
import java.util.*;
import java.util.function.Consumer;
/** Native stage membership diagram. Does not invent supply edges between companies. */
final class IndustryGraph extends View {
 private JSONArray rows=new JSONArray();private final List<RectF> boxes=new ArrayList<>();private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private String selected="";private boolean dark;
 Consumer<String> onSelected;
 IndustryGraph(Context c){super(c);setTag("industryGraph");setLayerType(View.LAYER_TYPE_SOFTWARE,null);}
 private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
 void setRows(JSONArray value){rows=value;boxes.clear();Map<String,Integer> counts=new HashMap<>();int height=dp(140);for(int i=0;i<rows.length();i++){JSONObject r=rows.optJSONObject(i);int column=Arrays.asList(ResearchCompanies.STAGES).indexOf(r.optString("stage"));if(column<0)column=5;String stage=r.optString("stage");int row=counts.getOrDefault(stage,0);counts.put(stage,row+1);RectF box=new RectF(dp(8+column*210),dp(70+row*96),dp(208+column*210),dp(158+row*96));boxes.add(box);height=Math.max(height,(int)box.bottom+dp(15));}setMinimumWidth(dp(1270));setMinimumHeight(height);requestLayout();invalidate();}
 void setSelected(String key){selected=key;invalidate();}
 void setDarkTheme(boolean value){dark=value;invalidate();}
 protected void onDraw(Canvas canvas){super.onDraw(canvas);canvas.drawColor(dark?0xff101a27:Color.WHITE);paint.setColor(dark?0xffdae5f5:0xff1f3048);paint.setTextSize(dp(13));canvas.drawText("环节归属图 · 点击节点看原文，不表示供货关系",dp(8),dp(24),paint);for(int i=0;i<6;i++)canvas.drawText(ResearchCompanies.LABELS[i],dp(8+i*210),dp(52),paint);for(int i=0;i<boxes.size();i++){JSONObject r=rows.optJSONObject(i);RectF rect=boxes.get(i);paint.setColor(selected.equals(r.optString("key"))?0xff3b6590:dark?0xff213347:0xffe8eef6);canvas.drawRoundRect(rect,dp(5),dp(5),paint);paint.setColor(selected.equals(r.optString("key"))?Color.WHITE:dark?0xffdae5f5:0xff1f3048);String[] lines={r.optString("companyName"),r.optString("product"),ResearchCompanies.statusLabel(r.optString("status"))};for(int line=0;line<lines.length;line++){String text=lines[line];while(paint.measureText(text)>rect.width()-dp(12)&&text.length()>1)text=text.substring(0,text.length()-1);if(!text.equals(lines[line]))text=text+"…";canvas.drawText(text,rect.left+dp(6),rect.top+dp(22+line*24),paint);}}}
 public boolean onTouchEvent(MotionEvent e){if(e.getAction()!=MotionEvent.ACTION_UP)return true;for(int i=0;i<boxes.size();i++)if(boxes.get(i).contains(e.getX(),e.getY())){String key=rows.optJSONObject(i).optString("key");setSelected(key);if(onSelected!=null)onSelected.accept(key);performClick();return true;}return true;}
 public boolean performClick(){super.performClick();return true;}
}
