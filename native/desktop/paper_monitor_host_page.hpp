#pragma once
#include <QtWidgets>
#include <memory>
#include "paper_monitor_flow.hpp"
#include "paper_automation_page.hpp"
namespace paperHost {
class Page:public QWidget {
public:
 explicit Page(std::shared_ptr<Flow> flow,QWidget*parent=nullptr);
 void setAutomationHost(std::function<QJsonObject()> preferences,std::function<void(QJsonArray)> refresh,QNetworkAccessManager* fixture=nullptr);
 bool back();void setActive(bool value);void setDarkTheme(bool dark);QJsonObject saveState();void restoreState(QJsonObject marker);
private:
 std::shared_ptr<Flow> flow;QStackedWidget* stack;QWidget* main;QWidget* settings=nullptr;
 QComboBox *accounts,*history;QCheckBox *scope,*decisionAck;QPlainTextEdit *response,*reader;QLabel*status;QPushButton *confirm,*reject;
 paperAutomation::Page* automation=nullptr;QNetworkAccessManager* automationFixture=nullptr;std::function<QJsonObject()> automationPreferences;std::function<void(QJsonArray)> automationRefresh;void showAutomation();
 bool filling=false,responseDirty=false;QTimer saveTimer;void guard(std::function<void()> action);void runMain(std::function<void()> action);void render();void refreshAccounts();void showSettings();void flushResponse();
protected:
 void hideEvent(QHideEvent*event)override;
};
}
