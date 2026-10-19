package org.marketreview.nativeapp;
import org.json.JSONObject;
import java.util.function.BooleanSupplier;
/** Read-only adapter to the frozen native board source implementation. */
final class IndustryDiscoveryFeed implements AutoCloseable {
 final SectorWatchFeed peer;IndustryDiscoveryFeed(){peer=new SectorWatchFeed();}IndustryDiscoveryFeed(SectorWatchFeed.Transport transport){peer=new SectorWatchFeed(transport);}
 JSONObject fetch(JSONObject query,BooleanSupplier cancel)throws Exception{SectorWatchModel.key(query);return peer.fetch(query,cancel);}
 void cancel(){peer.cancel();}public void close(){peer.close();}
}
