package org.marketreview.nativeapp;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import org.json.*;

/** Host-only selection and bounded transport checks. No live HTTP or Android UI. */
final class EtfSourceImageChecks {
  static int checks;
  static void check(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
  interface Action{void run()throws Exception;}
  static void rejects(Action action,String message)throws Exception{
    boolean rejected=false;try{action.run();}catch(IllegalArgumentException expected){rejected=true;}check(rejected,message);
  }
  static byte[] response;
  static int status=200,opens;
  static long declared=-1;
  static Runnable afterRead;
  static FakeConnection last;
  static final class FakeConnection extends HttpURLConnection {
    boolean disconnected;
    FakeConnection(URL url){super(url);}
    public void connect(){}
    public boolean usingProxy(){return false;}
    public void disconnect(){disconnected=true;}
    public int getResponseCode(){return status;}
    public long getContentLengthLong(){return declared;}
    public InputStream getInputStream(){return new ByteArrayInputStream(response){
      public synchronized int read(byte[] bytes,int offset,int length){
        int count=super.read(bytes,offset,length);
        if(afterRead!=null){Runnable action=afterRead;afterRead=null;action.run();}
        return count;
      }
    };}
  }
  public static void main(String[] args)throws Exception{
    JSONObject report=new JSONObject(Files.readString(Path.of(args[0])));
    String before=report.toString(),url=report.getString("originalImageUrl");
    EtfSourceImage selection=new EtfSourceImage();
    check(selection.select(report)&&selection.url.equals(url),"selected report supplies official image");
    long first=selection.generation;
    check(!selection.select(new JSONObject(before))&&selection.current(first),"same report render keeps active image request");
    JSONObject next=new JSONObject(before).put("asOf","2026-10-21");
    check(selection.select(next)&&!selection.current(first),"same URL on a different date invalidates late image");
    long second=selection.generation;
    check(selection.select(new JSONObject(before).put("originalImageUrl",JSONObject.NULL))&&!selection.current(second)&&selection.url.isEmpty(),"missing image clears preceding date");
    check(selection.select(new JSONObject(before).put("originalImageUrl","https://evil.example/image.jpg"))&&selection.url.isEmpty(),"unsupported image source cannot start display request");
    selection.select(report);long cancelled=selection.generation;selection.clear();
    check(!selection.current(cancelled)&&selection.select(report),"cancel rejects late completion and permits explicit retry");
    check(report.toString().equals(before)&&report.getJSONArray("subscriptions").length()==3&&report.getJSONArray("redemptions").length()==3,"image selection never fabricates extra structured rows or changes report");
    check(EtfSourceImage.safeDimensions(1000,3362),"complete captured long image fits decode bounds");
    check(!EtfSourceImage.safeDimensions(0,1)&&!EtfSourceImage.safeDimensions(-1,1)&&!EtfSourceImage.safeDimensions(100000,100000)&&!EtfSourceImage.safeDimensions(Integer.MAX_VALUE,Integer.MAX_VALUE),"invalid and excessive decoded image bounds rejected without integer overflow");
    URL.setURLStreamHandlerFactory(protocol->protocol.equals("https")?new URLStreamHandler(){
      protected URLConnection openConnection(URL value){opens++;return last=new FakeConnection(value);}
    }:null);
    response=Files.readAllBytes(Path.of(args[1]));byte[] imageBytes=response.clone();
    EtfDaily.Fetch fetch=new EtfDaily.Fetch();
    check(Arrays.equals(fetch.getImage(url),imageBytes),"image fetch preserves full official bytes");
    check(!last.getInstanceFollowRedirects()&&last.getConnectTimeout()==12000&&last.getReadTimeout()==12000&&last.disconnected,"image request retains no redirects, timeout and cleanup");
    int originalOpens=opens;
    for(String invalid:new String[]{url.replace("https:","http:"),url.replace("np-newspic.dfcfw.com","evil.example"),url+"?redirect=x",url+"#x",url.replace("https://","https://user@"),url.replace(".com/",".com:443/"),report.getString("sourceUrl")})rejects(()->new EtfDaily.Fetch().getImage(invalid),"unsafe image URL rejected before connection");
    check(opens==originalOpens,"invalid image URLs never open connection");
    rejects(()->new EtfDaily.Fetch().get(url,1000),"ordinary report requests still reject image endpoint");
    status=302;rejects(()->new EtfDaily.Fetch().getImage(url),"redirect response rejected");status=200;
    declared=EtfSourceImage.MAX_BYTES+1L;rejects(()->new EtfDaily.Fetch().getImage(url),"declared oversized image rejected");declared=-1;
    response=new byte[EtfSourceImage.MAX_BYTES+1];rejects(()->new EtfDaily.Fetch().getImage(url),"streaming image byte limit enforced");
    response=imageBytes;fetch=new EtfDaily.Fetch();fetch.cancel();final EtfDaily.Fetch cancelledFetch=fetch;originalOpens=opens;
    rejects(()->cancelledFetch.getImage(url),"cancelled image request rejected");check(opens==originalOpens,"cancelled image request does not connect");
    EtfDaily.Fetch interrupted=new EtfDaily.Fetch();afterRead=interrupted::cancel;
    rejects(()->interrupted.getImage(url),"cancellation during read stops the pending image");
    check(last.disconnected,"in-flight cancellation disconnects the image response");
    JSONObject checked=EtfDaily.validate(report);
    check(checked.getString("asOf").equals("2026-10-22")&&report.toString().equals(before),"real report remains valid and unchanged after image failures");
    System.out.println(new JSONObject().put("result","PASS").put("checks",checks).put("liveNetworkRun",false).put("deviceUiRun",false).put("structuredSubscriptions",3).put("structuredRedemptions",3));
  }
}
