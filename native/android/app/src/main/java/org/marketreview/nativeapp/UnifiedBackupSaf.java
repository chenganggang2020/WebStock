package org.marketreview.nativeapp;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;

/** Root callbacks only. Does not launch an Activity, request grants, or pick a URI. */
public final class UnifiedBackupSaf {
 public static UnifiedBackupFiles.Source source(ContentResolver resolver,Uri uri){return ()->resolver.openInputStream(uri);}
 // Call only for this operation's successful ACTION_CREATE_DOCUMENT result.
 // Unknown/nonzero existing length blocks before openOutputStream; no truncation fallback.
 public static UnifiedBackupFiles.NewTarget createdDocument(ContentResolver resolver,Uri uri,Uri importedOriginal){
  return new UnifiedBackupFiles.NewTarget(){
   public void writeNew(byte[] bytes)throws Exception{
    need(uri!=null&&"content".equals(uri.getScheme())&&!uri.equals(importedOriginal),"目标不是本次创建的新文档或等于导入原件");
    try(Cursor cursor=resolver.query(uri,new String[]{OpenableColumns.SIZE},null,null,null)){
     need(cursor!=null&&cursor.moveToFirst()&&!cursor.isNull(0)&&cursor.getLong(0)==0,"文件提供方未确认新文档为空；未写入");
    }
    ParcelFileDescriptor descriptor=resolver.openFileDescriptor(uri,"rw");need(descriptor!=null,"新文档不可写");
    try(ParcelFileDescriptor.AutoCloseOutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)){
     out.write(bytes);out.flush();descriptor.getFileDescriptor().sync();
    }
   }
   public UnifiedBackupFiles.Source reopen(){return source(resolver,uri);}
  };
 }
 private UnifiedBackupSaf(){}
}
