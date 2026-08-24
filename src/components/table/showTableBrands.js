import { useRouter } from "next/navigation";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RiArrowDownSFill, RiArrowUpSFill, RiLock2Line } from "react-icons/ri";
import { Rating } from "react-simple-star-rating";
import { Input, Table } from "reactstrap";
import SettingContext from "../../helper/settingContext";
import { dateFormat, dateWithOnlyMonth } from "../../utils/customFunctions/DateFormat";
import usePermissionCheck from "../../utils/hooks/usePermissionCheck";
import Avatar from "../commonComponent/Avatar";
import NoDataFound from "../commonComponent/NoDataFound";
import Options from "./Options";
import Status from "./Status";
import TableLoader from "./TableLoader";
import { Loader } from "react-feather";
import ShowModal from "@/elements/alerts&Modals/Modal";
import Btn from "@/elements/buttons/Btn";
import CreateNewBrand from "@/app/(mainLayout)/brand/create/createNewBrand";

const ShowTableBrands = ({ current_page, per_page, mutate, isCheck, setIsCheck, url, sortBy, setSortBy, headerData, fetchStatus, moduleName, type, redirectLink, refetch, keyInPermission, link, fetchProduct = () => { } }) => {
  const { t } = useTranslation("common");
  const { convertCurrency } = useContext(SettingContext);
  const [edit] = usePermissionCheck(["edit", "destroy"]);
  const [colSpan, setColSpan] = useState();
  const [isLoading, setIsLoading] = useState(false);
  const [model, setModal] = useState(false);
  const router = useRouter();
  //  const originalDataLength = headerData?.data?.data?.filter((elem) => elem.system_reserve == "1").length;
  const originalDataLength = headerData?.data?.data?.length;
  /* Select All Data */
  const handleChange = (result) => {
    if (isCheck?.includes(result.id)) {
      let removeValue = [...isCheck];
      removeValue.splice(removeValue.indexOf(result.id), 1);
      setIsCheck(removeValue);
    } else setIsCheck([...isCheck, result.id]);
  };
  /* Sorting Data */
  const handleSort = (title) => {
    setSortBy({ ...sortBy, field: title, sort: `${sortBy.sort == "asc" ? "desc" : "asc"}` });
  };
  // Calculation For Row Head
  const countColSpan = () => {
    let totalColumn = headerData?.column?.length || 0;
    let isSerialNo = headerData.isSerialNo !== false ? 1 : 0;
    let isCheckbox = headerData?.checkBox ? 1 : 0;
    let isOption = headerData?.isOption ? 1 : 0;
    setColSpan(totalColumn + isSerialNo + isCheckbox + isOption);
  };
  // On mount calling the function
  useEffect(() => {
    countColSpan();
  }, []);
  // Clicking on Row data
  const isHandelEdit = (e, tableData, headerData) => {
    e.preventDefault();
    if (!headerData.noEdit) {
      if (headerData?.optionHead?.type == "View") {
        redirectLink ? redirectLink(tableData) : "";
      } else if (tableData.system_reserve !== "1" && headerData?.isOption) {
        tableData?.id && router.push(`/${link ? link.toLowerCase() : moduleName.toLowerCase()}/edit/${tableData.id}`);
      }
    }
  };
  // Getting Sub-objects data
  const getSubKeysData = (mainData, subKey) => {
    if (typeof mainData === "object" && subKey.length > 0) {
      const [key, ...remainingSubKey] = subKey;
      return getSubKeysData(mainData?.[key], remainingSubKey);
    } else {
      return mainData;
    }
  };

  const handleEdit = (tableData) => {
    router.push('/brand/edit/' + tableData?.id);
  }
  if (isLoading) return <Loader />;
  return (
    <>
      <div className="w-100 d-flex justify-content-end fs-5 py-3">
        <div className="w-50 d-flex justify-content-end gap-4">
          <button className="px-4 py-2 btn btn-primary fs-5" onClick={() => {
            setIsLoading(true);
            fetchProduct()
            setIsLoading(false);
          }}  >Refresh</button>
          <button className="px-4 py-2 btn btn-primary fs-5" onClick={() => setModal(true)} >Add</button>
        </div>
      </div>
      <Table id="table_id" className={`role-table table-hover ${headerData?.noCustomClass ? "" : "refund-table"} all-package theme-table datatable-wrapper`}>
        <TableLoader fetchStatus={fetchStatus} />
        <thead>
          <tr>
            <>
              <th>SN</th>
              <th>Brand</th>
              <th>Action</th>
            </>
          </tr>
        </thead>
        <tbody>
          {headerData?.data?.data?.length > 0 ? (
            headerData?.data?.data?.map((tableData, index) => (
              <tr key={index}>
                {/* {headerData?.checkBox && (
                  <td className="sm-width">
                    <Input className="custom-control-input checkbox_animated" checked={headerData?.data?.data?.[index]?.system_reserve !== "1" && isCheck?.includes(tableData?.id)} disabled={headerData?.data?.data?.[index]?.system_reserve == "1" ? true : false} onChange={(e) => handleChange(tableData)} type={"checkbox"} />
                  </td>
                )}
                {headerData.isSerialNo !== false && (
                  <td className="sm-width" onClick={(e) => isHandelEdit(e, headerData, tableData)}>
                    {index + 1 + (current_page - 1) * per_page}
                  </td>
                )} */}
                <>
                  <td>{index + 1}</td>
                  <td>
                    <div className="d-flex align-items-center gap-3">
                      <span className="d-inline-flex align-items-center justify-content-center rounded border bg-white" style={{ width: 56, height: 56, overflow: "hidden" }}>
                        <img
                          src={tableData?.image || "/assets/images/placeholder/brand.png"}
                          alt={`${tableData?.name || "Brand"} logo`}
                          style={{ width: 46, height: 46, objectFit: "contain" }}
                        />
                      </span>
                      <strong className="fs-5">{tableData?.name}</strong>
                    </div>
                  </td>
                  <td className="d-flex justify-content-center">
                    <div className="d-flex gap-2">
                      <button onClick={() => {
                        handleEdit(tableData)
                      }} style={{ padding: "4px 6px", fontSize: "12px" }} className="btn btn-warning">Edit</button>
                      {/* <button onClick={() => handleDelete(tableData)} style={{ padding: "4px 6px", fontSize: "12px" }} className="btn btn-danger">Delete</button> */}
                    </div>
                  </td>
                </>
                {headerData?.isOption && <td>{headerData?.data?.data?.[index]?.system_reserve == "1" ? <RiLock2Line /> : <Options fullObj={tableData} mutate={mutate} moduleName={moduleName} type={type} optionPermission={headerData} refetch={refetch} keyInPermission={keyInPermission} />}</td>}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={colSpan}>
                <NoDataFound noImage={true} />
              </td>
            </tr>
          )}
        </tbody>
      </Table>

      <ShowModal
        open={model}
        close={false}
        buttons={
          <>
            <Btn title="Close" onClick={() => setModal(false)} className="btn-md btn-outline fw-bold" />
            {/* <Btn title="Yes" onClick={() => handleLogout()} className="btn-theme btn-md fw-bold" /> */}
          </>
        }
      >
        <div className="remove-box">
          {/* <div className="remove-icon">
                  <RiQuestionLine className="icon-box wo-bg" />
                </div>
                <h5 className="modal-title">{t("Confirmation")}</h5>
                <p>{t("Areyousureyouwanttoproceed?")} </p> */}
          {
            <CreateNewBrand model={model} />
          }
        </div>
      </ShowModal>
    </>
  );
};

export default ShowTableBrands;
