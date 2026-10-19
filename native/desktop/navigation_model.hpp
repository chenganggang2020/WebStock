#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QStringList>
#include <QVector>
#include <QSet>
namespace navigation {
struct Entry { QString id, group, title, page; int tab=-1; };
inline QStringList groups(){return {"主页","自选与账户","资金","研究","采集","模拟","设置"};}
inline const QVector<Entry>& entries(){
 static const QVector<Entry> all{
  {"home","主页","看盘工作台","home"},
  {"marketOverview","主页","市场全景 / 热度","marketOverview"},
  {"globalMarket","主页","全球行情","globalMarket"},
  {"marketComparison","主页","大盘对比","marketComparison"},
  {"sectorWatch","主页","板块观察 / K线","sectorWatch"},
  {"securitiesDirectory","主页","全目录 / 深度搜索","securitiesDirectory"},
  {"legacyHighFrequency","主页","旧5秒 / 30秒历史","legacyHighFrequency"},
  {"publicPriceDetails","主页","历史价格详情","publicPriceDetails"},
  {"news","主页","资讯 / 公告","news"},
  {"watchlistManage","自选与账户","自选 / 分组管理","watchlistHost"},
  {"watchlistWorkspace","自选与账户","编辑自选分组","watchlistWorkspace"},
  {"watchlistReconciliation","自选与账户","主自选变化协调","watchlistReconciliation"},
  {"accounts","自选与账户","账户账本 / 流水","accounts",0},
  {"accountAnalysis","自选与账户","资产 / 历史分析","accounts",1},
  {"accountEdit","自选与账户","账户资料 / 现金","accountEdit"},
  {"accountReference","自选与账户","今日参考盈亏","accountReference"},
  {"portfolioMirror","自选与账户","持仓镜像","portfolioMirror"},
  {"recent","自选与账户","最近查看","recent"},
  {"sectorLeaders","自选与账户","人工龙头 / 历史","sectorLeaders"},
  {"funds","资金","个股资金 / 回放","funds"},
  {"darkStocks","资金","个股明暗盘","darkStocks"},
  {"rotation","资金","板块轮动","rotation"},
  {"etfMonitor","资金","ETF盘中观察","etfMonitor"},
  {"etfDaily","资金","ETF申赎日报","etfDaily"},
  {"futuresMonitor","资金","期货价量仓","futuresMonitor"},
  {"cffexDisclosure","资金","期货指定日披露","cffexDisclosure"},
  {"auction","资金","集合竞价","auction"},
  {"auctionAnalysis","资金","竞价形态 / 历史","auctionAnalysis"},
  {"research","研究","原文 / 证据库","research",0},
  {"industry","研究","产业链 / 公司","research",1},
  {"creator","研究","作者观点 / 关系","research",2},
  {"stockResearch","研究","个股主营 / F10","stockResearch"},
  {"businessSearch","研究","主营资料搜索","businessSearch"},
  {"localCandidates","研究","本地候选","localCandidates"},
  {"industryDiscovery","研究","产业概念发现","industryDiscovery"},
  {"industryTopic","研究","产业主题更新","industryTopic"},
  {"sectorResearch","研究","板块 / 产业研究","sectorResearch"},
  {"evidenceReview","研究","报告 / 引用复核","evidenceReview"},
  {"personMethod","研究","人物 / 方法","personMethod"},
  {"materialLibrary","研究","全量资料库","materialLibrary"},
  {"knowledgeAiHost","研究","全文检索 / 研究请求","knowledgeAiHost"},
  {"quantResearch","研究","量化 / 旧Parquet","quantResearch"},
  {"analysis","研究","本机分析材料","research",3},
  {"handoff","研究","交接历史","research",4},
  {"researchRuns","研究","历史研究报告","research",5},
  {"researchWorkbench","研究","研究编排 / 整批导入","research",6},
  {"comments","研究","评论工坊","research",7},
  {"collection","采集","作者视频 / 文稿","collection",0},
  {"sources","采集","来源 / 自动采集","collection",1},
  {"sourcePlans","采集","作者计划 / 运行历史","collection",2},
  {"collectionAnalysis","采集","分析材料 / 交接","collection",3},
  {"collectionHandoff","采集","交接历史","collection",4},
  {"paper","模拟","纸面账本 / 流水","paper",0},
  {"paperAnalysis","模拟","纸面资产 / 历史","paper",1},
  {"paperMonitor","模拟","纸面监控 / 模拟成交","paperMonitor"},
  {"scenarioTools","模拟","情景测算 · 20工具","scenarioTools"},
  {"settings","设置","业务备份 / 恢复","settings"},
  {"unifiedBackupSetup","设置","统一备份 / 逐项恢复","unifiedBackupSetup"},
  {"aiSettings","设置","AI偏好 / 当次授权","aiSettings"},
  {"riskSettings","设置","风险阈值 / 提醒","riskSettings"},
  {"dataSafety","设置","数据位置 / 安全","dataSafety"},
  {"dataSourceStatus","设置","数据来源 / 时点","dataSourceStatus"},
  {"migrationStatus","设置","功能迁移状态","migrationStatus"},
  {"legacyArchive","设置","旧版原始档案","legacyArchive"}
 };return all;
}
inline QStringList defaults(const QString& group){QStringList out;for(const auto&e:entries())if(e.group==group)out<<e.id;return out;}
// Unknown/duplicate IDs cannot inject routes; newly added entries remain discoverable.
inline QStringList ordered(const QJsonObject& state,const QString& group){
 auto known=defaults(group);QStringList out;
 for(auto v:state["groups"].toObject()[group].toObject()["order"].toArray())if(v.isString()&&known.contains(v.toString())&&!out.contains(v.toString()))out<<v.toString();
 for(auto id:known)if(!out.contains(id))out<<id;return out;
}
inline bool hidden(const QJsonObject& state,const QString& group,const QString& id){return state["groups"].toObject()[group].toObject()["hidden"].toArray().contains(id);}
inline QJsonObject normalized(const QJsonObject& input){
 QJsonObject result{{"schema","stock-navigation/v1"}},gs;
 const auto source=input["schema"]=="stock-navigation/v1"?input:QJsonObject{};
 for(auto g:groups()){QJsonArray order,hide;for(auto id:ordered(source,g)){order.append(id);if(hidden(source,g,id))hide.append(id);}gs[g]=QJsonObject{{"order",order},{"hidden",hide}};}
 result["groups"]=gs;return result;
}
inline const Entry* find(const QString& id){for(const auto&e:entries())if(e.id==id)return &e;return nullptr;}
}
