package org.marketreview.nativeapp;
/** Small authority and viewport contract shared by the real Android controller and JVM checks. */
final class ChartFullscreenState {
  private boolean open,foreground,closed;private long generation;private String symbol="";
  boolean open(){return open;}
  long ticket(){return generation;}
  boolean accepts(long token,boolean visible){return token!=0&&token==generation&&open&&foreground&&!closed&&visible;}
  long enter(String symbol,boolean current){need(!closed&&foreground&&current&&symbol!=null&&!symbol.isEmpty(),"original visible chart required");if(open){need(this.symbol.equals(symbol),"different chart owner");return generation;}this.symbol=symbol;open=true;return ++generation;}
  void foreground(boolean value){if(foreground&&!value)generation++;foreground=value;}
  boolean leave(){boolean had=open;open=false;symbol="";generation++;return had;}
  void close(){leave();closed=true;foreground=false;}
  static void need(boolean value,String message){if(!value)throw new IllegalArgumentException(message);}
  static void times(double[] times,boolean[] valid){need(times!=null&&valid!=null&&times.length==valid.length,"source lengths");for(int i=0;i<times.length;i++)need(Double.isFinite(times[i])&&(i==0||times[i]>=times[i-1]),"invalid time order");}
  static int latest(boolean[] valid){for(int i=valid.length-1;i>=0;i--)if(valid[i])return i;return -1;}
  static Viewport capture(double[] times,boolean[] valid,int end,int count,int selected,boolean minute){
    times(times,valid);int n=times.length;need(end>=0&&end<=n&&count>=1&&selected>=-1&&selected<n,"viewport out of bounds");
    return new Viewport(selected<0?-1:times[selected],end==0?-1:times[end-1],count,end>=n,selected==latest(valid));
  }
  static final class Viewport {
    final double selectedTime,endTime;final int count;final boolean followEnd,followSelected;
    Viewport(double selectedTime,double endTime,int count,boolean followEnd,boolean followSelected){need(Double.isFinite(selectedTime)&&Double.isFinite(endTime)&&selectedTime>=-1&&endTime>=-1&&count>=1&&count<=1000000,"invalid viewport");this.selectedTime=selectedTime;this.endTime=endTime;this.count=count;this.followEnd=followEnd;this.followSelected=followSelected;}
    int[] resolve(double[] times,boolean[] valid,boolean minute){
      times(times,valid);int n=times.length;if(n==0)return new int[]{0,1,-1};
      int end=n,selected=-1;
      if(!followEnd&&!minute){end=1;while(end<n&&times[end-1]<endTime)end++;}
      if(followSelected)selected=latest(valid);else if(selectedTime>=0)for(int i=0;i<n;i++)if(times[i]==selectedTime){selected=i;break;}
      return new int[]{end,minute?n:Math.max(1,Math.min(count,n)),selected};
    }
  }
  static final class Layout {
    final int width,titleHeight,controlsHeight,readoutHeight,chartHeight;
    Layout(int width,int height){this.width=width;titleHeight=40;controlsHeight=48;readoutHeight=height>=280?32:0;chartHeight=Math.max(0,height-titleHeight-controlsHeight-readoutHeight);}
  }
  static Layout layout(int width,int height,int left,int top,int right,int bottom){need(left>=0&&top>=0&&right>=0&&bottom>=0&&width>left+right&&height>top+bottom,"invalid safe area");return new Layout(width-left-right,height-top-bottom);}
}
