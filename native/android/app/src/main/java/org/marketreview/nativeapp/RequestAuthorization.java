package org.marketreview.nativeapp;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.util.function.LongSupplier;
/** Memory-only exact ordered-request authority, with no persistence API. */
public final class RequestAuthorization {
 private final LongSupplier clock;
 private List<AiKnowledgeRequest.Prepared> requests=new ArrayList<>();
 private final List<AiKnowledgeRequest.Grant> issued=new ArrayList<>();
 private byte[] secret=new byte[0];private int cursor;private long expires;
 private boolean approved;private AiKnowledgeRequest.Grant pending;
 public RequestAuthorization(){this(System::currentTimeMillis);}
 RequestAuthorization(LongSupplier now){clock=now;}
 private static void need(boolean ok,String code)throws Exception{if(!ok)throw new Exception(code);}
 private void wipe(){Arrays.fill(secret,(byte)0);secret=new byte[0];}
 public synchronized void revoke(){for(AiKnowledgeRequest.Grant g:issued)g.revoke();issued.clear();pending=null;wipe();approved=false;expires=0;cursor=0;}
 public synchronized void unbind(){revoke();requests=new ArrayList<>();}
 public synchronized void bind(List<AiKnowledgeRequest.Prepared> list)throws Exception{revoke();requests=new ArrayList<>();need(list!=null&&!list.isEmpty()&&list.size()<=19,"authorization-request-count");requests=new ArrayList<>(list);}
 public synchronized List<AiKnowledgeRequest.Prepared> review(){return new ArrayList<>(requests);}
 public synchronized void approve(byte[] credential,boolean reviewed,boolean model,boolean billing,boolean active,long ttl)throws Exception{
  revoke();try{need(active&&!requests.isEmpty()&&reviewed&&model&&billing,"explicit-request-consent-required");need(ttl>0&&ttl<=300000,"authorization-lifetime-invalid");
   need(credential!=null&&new String(credential,StandardCharsets.US_ASCII).matches("[A-Za-z0-9_.-]{16,4096}"),"credential-format-invalid");
   String value=new String(credential,StandardCharsets.US_ASCII);for(AiKnowledgeRequest.Prepared p:requests)need(!p.preview().toString().contains(value),"credential-found-in-material");
   secret=credential.clone();expires=clock.getAsLong()+ttl;approved=true;
  }finally{if(credential!=null)Arrays.fill(credential,(byte)0);}
 }
 public synchronized boolean ready(){return approved&&clock.getAsLong()<expires&&cursor<requests.size()&&pending==null;}
 public synchronized long deadline(){return expires;}
 public synchronized AiKnowledgeRequest.Grant authorize(AiKnowledgeRequest.Prepared r)throws Exception{
  need(approved&&clock.getAsLong()<expires&&cursor<requests.size()&&pending==null,"authorization-required-or-stale");
  AiKnowledgeRequest.Prepared exact=requests.get(cursor);need(exact.digest().equals(r.digest())&&Arrays.equals(exact.body(),r.body()),"authorization-request-binding-mismatch");
  pending=new AiKnowledgeRequest.Grant(exact.digest(),expires,true,true,true);issued.add(pending);return pending;
 }
 public synchronized byte[] acquire()throws Exception{
  need(approved&&clock.getAsLong()<expires&&pending!=null&&pending.isConsumed()&&!pending.isRevoked(),"credential-without-consumed-request-grant");
  byte[] value=secret.clone();pending=null;++cursor;if(cursor==requests.size()){wipe();approved=false;}return value;
 }
}
