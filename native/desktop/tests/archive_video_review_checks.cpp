#include "archive_video_review_model.hpp"
#include <QApplication>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QThread>
#include "archive_video_review_page.hpp"
#include <QTemporaryDir>
#include <QFile>
#include <QCryptographicHash>
#include <cassert>
int main(int argc,char**argv){QApplication app(argc,argv);QTemporaryDir root;QString p=root.path()+"/fixture.media";QFile f(p);assert(f.open(QIODevice::WriteOnly));f.write("test-only bytes");f.close();QJsonObject row{{"id","fixture"},{"assetPath",p},{"text","edited"},{"archive",QJsonObject{{"assetPath",p},{"bytes",15},{"sha256",QString(QCryptographicHash::hash("test-only bytes",QCryptographicHash::Sha256).toHex())}}}};auto check=[&](QJsonObject r,QJsonObject c,QStringList roots){return archiveVideoReview::inspect(r,c,roots)["playable"].toBool();};assert(check(row,row,{root.path()}));auto changed=row;changed["text"]="changed";assert(!check(row,changed,{root.path()}));assert(!check(row,row,{root.path()+"/elsewhere"}));QJsonArray segments;for(int i=0;i<45;i++)segments.append(QJsonObject{{"start",i},{"end",i+1},{"text",QString::number(i)}});row["asrResult"]=QJsonObject{{"segments",segments}};auto missing=row;missing.remove("archive");assert(!check(missing,missing,{root.path()}));auto bad=row;auto archive=bad["archive"].toObject();archive["sha256"]=QString(64,'0');bad["archive"]=archive;assert(!check(bad,bad,{root.path()}));assert(row["text"]=="edited");assert(archiveVideoReview::seekSeconds(QJsonObject{{"start",1},{"end",2}},10)==1);assert(archiveVideoReview::seekSeconds(QJsonObject{{"start",-1},{"end",2}},10)<0);assert(archiveVideoReview::seekSeconds(QJsonObject{{"start",8},{"end",12}},10)<0);assert(archiveVideoReview::seekSeconds(QJsonObject{{"text","missing"}},10)<0); {ArchiveVideoReviewPage page(missing,{root.path()},[missing](QString){return missing;});page.setActive(true);for(auto text:page.findChildren<QPlainTextEdit*>())assert(text->isReadOnly());for(auto button:page.findChildren<QPushButton*>()){if(button->text()==QString::fromUtf8("播放"))assert(!button->isEnabled());if(button->text()==QString::fromUtf8("核验并打开归档"))button->click();}page.setActive(false);for(int i=0;i<10;i++){app.processEvents();QThread::msleep(2);}assert(page.findChildren<QPushButton*>().size()==25);for(auto button:page.findChildren<QPushButton*>())if(button->text()==QString::fromUtf8("下一页逐字稿")){button->click();break;}assert(page.saveState()["segmentPage"].toInt()==1);page.restoreState(page.saveState());assert(page.saveState()["paused"].toBool());} qInfo("ArchiveVideoReview Qt guard checks PASS (fixture bytes; no codec acceptance)");}



