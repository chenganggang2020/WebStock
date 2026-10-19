#pragma once
#include <QtCore>
#include <functional>
#include "paper_monitor_store.hpp"
#include "paper_policy_settings.hpp"
namespace paperHost {
class Flow {
public:
 struct Host {std::function<QJsonObject()> read;std::function<QString()> now;};
 Flow(Host host,QString privateDirectory,QString evidenceDirectory);
 QJsonArray accounts();void selectAccount(QString id);QJsonObject currentAccount();
 QJsonObject prepare(bool acknowledged);void setResponse(QString text);QJsonObject preview();
 QJsonObject decide(QString choice,bool explicitConfirmation);
 void cancel();void setActive(bool value);bool isActive()const{return active;}QJsonArray history();void selectHistory(int index);
 QJsonObject state()const;QJsonObject marker();void restore(const QJsonObject& marker);
 QString settingsPath()const;QString now()const;
 QString automationPath()const;QJsonObject automationSnapshot();
private:
 Host host;QString directory,evidence;paperMonitor::Store archive;paperPolicy::Store policy;
 QJsonObject draft,baseline,prepared,previewed; qint64 archiveRevision=-1;
 bool active=false,writable=true;
 QJsonObject loadDraft()const;void persist(bool verifyCurrent=true);void invalidate();void mustRun()const;
 QJsonObject row()const;void setRow(QJsonObject value);QJsonObject input(QJsonObject envelope,bool requireContinuous=true);
};
}
