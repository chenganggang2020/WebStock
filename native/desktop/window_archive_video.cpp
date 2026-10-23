#include "window.hpp"
#include "archive_video_review_page.hpp"
#include <QtWidgets>
void Window::archiveVideoView(const QJsonObject& row){
 const auto current=BusinessStore::readRecord(businessStore->filePath(),"collections",row["id"].toString());
 business::require(!row["id"].toString().isEmpty()&&!current.isEmpty()&&current==row,"归档作品记录已变化，请重新选择");
 if(auto*old=dynamic_cast<ArchiveVideoReviewPage*>(pages.value("archiveVideo"))){old->close();workspaceTabs->removeTab(workspaceTabs->indexOf(old));pages.remove("archiveVideo");delete old;}
 QStringList roots{QFileInfo(businessStore->filePath()).absolutePath()+"/collection-media"};
 // Legacy paths are retained, not copied into or rewritten as new archives.
 if(row["legacySource"].toString()==QStringLiteral("expert_observations"))roots<<"D:/WebstockRuntime/data/media-library/douyin"<<"D:/WebstockRuntime/releases/WebStockData/media-library/douyin";
 auto*page=new ArchiveVideoReviewPage(row,roots,[this](QString id){return BusinessStore::readRecord(businessStore->filePath(),"collections",id);},workspaceTabs);
 page->setProperty("workspace","采集");page->setProperty("pageTitle","归档视频 / 逐字稿复核");pages["archiveVideo"]=page;activatePage(page);page->setActive(true);
}

