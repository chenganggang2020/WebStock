#pragma once
#include "account_analysis.hpp"
#include <QWidget>
#include <functional>
#include <memory>
class QComboBox;class QLineEdit;class QDateEdit;class QLabel;class QTableWidget;class QPlainTextEdit;
class AccountAnalysisPage final:public QWidget {
public:
 AccountAnalysisPage(std::shared_ptr<BusinessStore>,bool paper,std::function<QJsonArray()> instruments,QWidget* parent=nullptr);
 void setAccount(QString id);void reload();
private:
 std::shared_ptr<BusinessStore> store;bool paper;std::function<QJsonArray()> instruments;QComboBox* accounts;QLabel *state,*summary;QTableWidget *positions,*history,*flows;QPlainTextEdit* original;QWidget* plot;
 QJsonObject active;bool filling=false;
};
