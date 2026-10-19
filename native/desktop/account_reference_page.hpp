#pragma once
#include "account_reference_model.hpp"
#include <QWidget>
#include <functional>
class QLabel;class QTableWidget;class QPlainTextEdit;
class AccountReferencePage final:public QWidget {
public:
 using Reader=std::function<QJsonObject()>;
 explicit AccountReferencePage(Reader,QWidget*parent=nullptr);
 void reload();void setDarkTheme(bool);QJsonObject frozenOutput()const{return output;}
private:
 Reader reader;QJsonObject output;QLabel*summary;QTableWidget*rows;QPlainTextEdit*detail;
};

