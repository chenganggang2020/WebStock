#pragma once
#include "industry_topic_runtime.hpp"
#include "industry_topic_view.hpp"
#include <QWidget>
#include <QComboBox>
#include <QCheckBox>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QLabel>
#include <QListWidget>
#include <QStackedWidget>
#include <QVBoxLayout>
#include <QPushButton>
class IndustryTopicPage final:public QWidget {
 QString directory,expectedState,draftSha,baselineSha,fullText,exportText,exportName="产业主题完整阅读.txt",readingKey="archive";industryTopicUpdate::Runtime*runtime;std::function<QJsonArray()>rows;industryTopicUpdate::Draft draft;QComboBox*baselines,*topics;QPlainTextEdit*urls,*proposals,*reader;QLineEdit*interval;QCheckBox*enabled,*ack;QWidget*sourceBox,*toolbar,*readerbar;QVBoxLayout*sourceLayout;QListWidget*records;QLabel*state;QStackedWidget*pages;QList<QCheckBox*>sourceChecks;QJsonArray baseRows,topicRows;bool active=false,filling=false;int mode=0,segment=0;quint64 epoch=0;
 using Action=std::function<void()>;
 void safe(Action);QPushButton*button(QHBoxLayout*,QString,QString,Action);void changed();void loadTopic();void showMode(int);void showReading();void open(QString);QString topic()const;QJsonArray selectedSources()const;void applySources(QJsonArray);QJsonObject config()const;QJsonObject draftValue()const;void restore(QJsonObject);void reloadHistory();
protected:void hideEvent(QHideEvent*)override;
public:
 std::function<void(QString,QString)> exportRequested;
 IndustryTopicPage(QString privateDirectory,industryTopicUpdate::Runtime*,std::function<QJsonArray()>,QWidget*parent=nullptr);
 ~IndustryTopicPage()override;
 void setActive(bool);void reload();QJsonObject saveState();void restoreState(QJsonObject);
};
