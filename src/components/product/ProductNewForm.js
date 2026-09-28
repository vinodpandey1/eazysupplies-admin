import { Form, Formik } from "formik";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import FormBtn from "../../elements/buttons/FormBtn";
import CategoryContext from "../../helper/categoryContext";
import request from "../../utils/axiosUtils";
import { nameSchema, descriptionSchema, YupObject, numberSchema, roleIdSchema } from "../../utils/validation/ValidationSchemas";
import Loader from "../commonComponent/Loader";
import CheckBoxField from "../inputFields/CheckBoxField";
import FileUploadField from "../inputFields/FileUploadField";
import MultiSelectField from "../inputFields/MultiSelectField";
import SearchableSelectInput from "../inputFields/SearchableSelectInput";
import SimpleInputField from "../inputFields/SimpleInputField";
import { Card, CardBody, Col, Row } from "reactstrap";

import { mediaConfig } from "../../data/MediaConfig";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import useCustomQuery from "../../utils/hooks/useCustomQuery";
import axios from "axios";
import { NumberSchema } from "yup";
import { SkuType } from "../../utils/constants/index";
import KeywordInput from "../inputFields/KeywordInput";
import FileImageUpload from "../inputFields/FileImageUpload";
import {ConvertIntoIso8601} from "../../utils/constants/index";
import EditorComponent from "../inputFields/EditorComponent";

const CategoryNewForm = ({ setResetData, updateId, loading, type, buttonName }) => {
  const { t } = useTranslation("common");
  const [catData, setCatData] = useState([]);
  const [brandData, setBrandData] = useState([]);
  const [tagData, setTagData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [taxData, setTaxData] = useState([]);
  const [productData, setProductData] = useState({});
  const [supplierData, setSupplierData] = useState([]);
  const submissionInFlight = useRef(false);
  const router = useRouter();

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (updateId) {
      loadProductData();
    }
  }, [updateId]);

  const loadProductData = async () => {
    const product = await axios.get('/api/products?productId=' + updateId);
    if (product.status == 200) {
      setProductData(product?.data?.data);
    }
  }
  const fetchData = async () => {
    const allData = await axios.get('/api/products/filter/filter_tag_brand_category?tag_brand_category=true');
    if (allData.status == 200) {
      const tagData = allData?.data?.tags?.map(item => ({ id: item.id, name: item.name }));
      setTagData(tagData);
      const brandData = allData?.data?.brands?.map(item => ({ id: item.id, name: item.name }));
      setBrandData(brandData);
      const tagCategory = allData?.data?.categories?.map(item => ({ id: item.id, name: item.name }));
      setCatData(tagCategory);
      const tax = allData?.data?.tax?.map(item => ({ id: item.id, name: item.name + "-" + item.value + "%", value: item.value }));
      setTaxData(tax);
      const supplier = allData?.data?.supplier?.map(item => ({ id: item.id, name: item.name }));
      setSupplierData(supplier);
    }
  }

  if (updateId && isLoading) return <Loader />;
  const handleSubmit = async (values, { setSubmitting }) => {
    if (submissionInFlight.current) return;

    submissionInFlight.current = true;
    setSubmitting(true);
    try {
      if (brandId == 0 || categoryId == 0) {
        alert('brand or category is missing');
      }
      // const taxDataFilter = taxData.filter(item => item.id == Number(values.tax));
      // if (taxDataFilter.length == 0) {
      //   alert('All field is mandatory!');
      // }
      const tagStr = (values.tags).toString();
      const supplierStr = (values.supplier).toString();
      const mfDate = values.mfDate? ConvertIntoIso8601(values.mfDate) : null;
      const expDate = values.expDate? ConvertIntoIso8601(values.expDate) : null;

      if (updateId) {
        const res = await axios.put('/api/products', {
          "id": Number(updateId),
          "name": values.name,
          "description": values.description,
          "price": values.price,
          "stock": values.stock,
          "categoryId": values.categoryId,
          "brandId": values.brandId,
          "tags": tagStr,
          "sku": values.sku,
          "skuType": values.skuType,
          "dimension": values.dimension,
          "tax": Number(values.tax),
          "supplier": supplierStr,
          "pkgUnit": values.pkgUnit.toString(),
          "mrp": values.mrp,
          "unitRate": values.unitRate,
          "status": values.status,
          "keyword": values.keyword.toString(),
          "mrp": values.mrp,
          "caseRate" : Number(values.price),
         // "images": values.images,
          "selfLife": values.selfLife,
          "pkgGwt": values.pkgGwt,
          "productImage" : values.productImage,
          "productIcon" : values.productImage,
          "mfDate": ConvertIntoIso8601(values.mfDate),
          "expDate": ConvertIntoIso8601(values.expDate)
        }, { withCredentials: true });

        if (res.status == 200) {
          alert('product: ' + values.name + " updated successfully!");
          router.push("/product");
        }
      } else {
        const res = await axios.post('/api/products', {
          "name": values.name,
          "description": values.description,
          "price": values.price,
          "stock": values.stock,
          "categoryId": values.categoryId,
          "brandId": values.brandId,
          "tags": tagStr,
          "sku": values.sku,
          "skuType": values.skuType,
          "dimension": values.dimension,
          "tax": Number(values.tax),
          "supplier": supplierStr,
          "pkgUnit": values.pkgUnit,
          "mrp": values.mrp,
          "unitRate": values.unitRate,
          "status": Boolean(values.status),
          "keyword": values.keyword.toString(),
          "mrp": Number(values.mrp),
          "caseRate" : Number(values.price),
         // "images": values.images,
          "selfLife": Number(values.selfLife),
          "productImage" : values.productImage,
          "productIcon" : values.productImage,
          "pkgGwt": values.pkgGwt,
          //"pkgCnt": values.pkgCnt,
          ...(mfDate && {"mfDate": mfDate}),
          ...( expDate && {"expDate": expDate})

        }, { withCredentials: true });

        if (res.status == 201) {
          alert('product: ' + values.name + " added successfully!");
          router.push("/product");
        }
      }

    } catch (err) {
      console.log('.........', err)
      alert('something went wrong, please try again!');
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }

  }

  return (
    <Row>
      <Col xl="2"></Col>
      <Col xl="8">
        <Card className={""}>
          <CardBody>
            <div className="title-header option-title">
              <h5>{t("")}</h5>
            </div>
            <Formik
              enableReinitialize
              initialValues={{
                name: Object.keys(productData).length > 0 ? productData?.name : "",
                description: Object.keys(productData).length > 0 ? productData?.description : "",
                price: Object.keys(productData).length > 0 ? productData?.price : 0.0,
                mrp: Object.keys(productData).length > 0 ? productData?.mrp : 0.0,
                stock: Object.keys(productData).length > 0 ? productData?.stock : 0,
                sku: Object.keys(productData).length > 0 ? productData?.sku : "",
                dimension: Object.keys(productData).length > 0 ? productData?.dimension : "",
                tax: Object.keys(productData).length > 0 ? Number(productData?.tax) : 0, //  :
                brandId: Object.keys(productData).length > 0 ? productData?.brand?.id : 0,
                categoryId: Object.keys(productData).length > 0 ? productData?.category?.id : 0,
                tags: Object.keys(productData).length > 0 ? (productData?.tags ? productData?.tags.split(',').map(Number) : []) : [],
                supplier: Object.keys(productData).length > 0 ? (productData?.tags ? productData?.supplier.split(',').map(Number) : []) : [],
                skuType: Object.keys(productData).length > 0 ? productData?.skuType : "",
                pkgUnit: Object.keys(productData).length > 0 ? Number(productData?.pkgUnit) : 0,
               // pkgCnt: Object.keys(productData).length > 0 ? Number(productData?.pkgCnt) : 0,
                unitRate: Object.keys(productData).length > 0 ? Number(productData?.unitRate) : 0,
                status: Object.keys(productData).length > 0 ? (productData?.status) : false,
                keyword: Object.keys(productData).length > 0
                  ? (productData?.keyword
                    ? productData.keyword.split(",")
                    : [])
                  : [],
                images: [],
                productImage : Object.keys(productData).length > 0 ? productData?.productImage : "",
                selfLife: Object.keys(productData).length > 0 ? productData?.selfLife : "",
                pkgGwt: Object.keys(productData).length > 0 ? productData?.pkgGwt : "",
                mfDate: Object.keys(productData).length > 0 && productData?.mfDate ? new Date(productData.mfDate).toISOString().slice(0, 16) :  "",
                expDate: Object.keys(productData).length > 0 && productData?.expDate ? new Date(productData.expDate).toISOString().slice(0, 16) : "",
              }}
              validationSchema={YupObject({
                name: nameSchema,
                description: descriptionSchema,
                price: numberSchema,
                stock: numberSchema,
                sku: nameSchema,
                dimension: nameSchema,
                tax: numberSchema,
                // brandId: roleIdSchema,
                // categoryId: roleIdSchema,
                //tags: nameSchema
              })}
              onSubmit={handleSubmit}
            >
              {({ setFieldValue, values, errors, isSubmitting }) => (
                <Form className="theme-form theme-form-2 mega-form">
                  <Row>
                    <SimpleInputField
                      nameList={[
                        {
                          name: "name",
                          title: "Name",
                          placeholder: t("Enter Product Name"),
                          require: "true",
                        }
                      ]}
                    />

            {/* 3. Add the EditorComponent manually for Description */}
                  <div className="mb-4 row align-items-center">
                    <label className="form-label-title col-sm-3 mb-0">
                      {t("Description")}
                    </label>
                    <div className="col-sm-9">
                      <EditorComponent
                        name="description"
                        value={values.description}
                        editorLoaded={true}
                        onChange={(data) => setFieldValue("description", data)}
                        onBlur={() => setFieldTouched("description", true)}
                      />
                    </div>
                  </div>

                    <SimpleInputField nameList={[{ name: "price", title: "Price", placeholder: t("Enter price"), type: "number", require: "true", }]} />
                    <SimpleInputField nameList={[{ name: "mrp", title: "MRP", placeholder: t("Enter Mrp"), type: "number", require: "true", }]} />
                    <SimpleInputField nameList={[{ name: "stock", title: "Stock", placeholder: t("Enter stock available"), type: "number", require: "true", }]} />
                    <SimpleInputField nameList={[{ name: "dimension", title: "Packaging", placeholder: t("Enter Packaging"), type: "text", require: "true", }]} />
                    <SimpleInputField nameList={[{ name: "sku", title: "Sku", placeholder: t("Enter HSN / SAC"), type: "text", require: "true", }]} />
                    {/* <SimpleInputField nameList={[{ name: "skuType", title: "Sku type", placeholder: t("Enter sku type eg PACKET | BOTTLE"), type: "text", require: "true", }]} /> */}
                    <SearchableSelectInput
                      nameList={[
                        {
                          name: "skuType",
                          title: "Sku Type",
                          require: "true",
                          inputprops: {
                            name: "skuType",
                            id: "skuType",
                            options: SkuType.length > 0 ? SkuType : [],
                            close: false,
                            isMulti: false,
                          },
                        },
                      ]}
                    />
                    <SimpleInputField nameList={[{ name: "pkgUnit", title: "Pkg Unit", placeholder: t("Enter pkg unit"), type: "text", require: "true", }]} />
                    <SimpleInputField nameList={[{ name: "unitRate", title: "Unit Rate", placeholder: t("Enter unit rate"), type: "number", require: "true", }]} />
                    {/* <SimpleInputField nameList={[{ name: "pkgCnt", title: "Pkg Count", placeholder: t("Enter pkg count"), type: "number", require: "true", }]} /> */}
                    <SimpleInputField nameList={[{ name: "pkgGwt", title: "Pkg Weight", placeholder: t("Enter pkg weight"), type: "string", require: "true", }]} />
                    <SimpleInputField nameList={[{ name: "selfLife", title: "Self Life(Months)", placeholder: t("Enter self life(months)"), type: "number", require: "true", }]} />
                    <SimpleInputField nameList={[{ name: "mfDate", title: "Manufacture Date", placeholder: "Manufacture Date", type: "datetime-local", require: "false", }]} />
                    <SimpleInputField nameList={[{ name: "expDate", title: "Expiry Date", placeholder: "Expiry Date", type: "datetime-local", require: "false", }]} />
                    <CheckBoxField name="status" title="Status" />
                    <SimpleInputField nameList={[{ name: "productImage", title: "Product Image", placeholder: t("Enter Product Image"), type: "text", require: "true", }]} />
                    {false && <FileImageUpload
                      name="images"
                      multiple={true}
                      
                      selectedFiles={values.images || []}
                      setSelectedFiles={(files) => setFieldValue("images", files)}
                      helperText="Upload image"
                    />}
                    <KeywordInput name="keyword" label="Keywords" required />

                    <SearchableSelectInput
                      nameList={[
                        {
                          name: "tax",
                          title: "Tax(%)",
                          require: "true",
                          inputprops: {
                            name: "tax",
                            id: "tax",
                            options: taxData.length > 0 ? taxData : [],
                            close: false,
                            isMulti: false
                          },
                        },
                      ]}
                    />
                    <SearchableSelectInput
                      nameList={[
                        {
                          name: "categoryId",
                          title: "Category",
                          require: "true",
                          inputprops: {
                            name: "categoryId",
                            id: "categoryId",
                            options: catData.length > 0 ? catData : [],
                            close: false,
                            isMulti: false
                          },
                        },
                      ]}
                    />
                    <SearchableSelectInput
                      nameList={[
                        {
                          name: "brandId",
                          title: "Brand",
                          require: "true",
                          inputprops: {
                            name: "brandId",
                            id: "brandId",
                            options: brandData.length > 0 ? brandData : [],
                            close: false,
                            isMulti: false
                          },
                        },
                      ]}
                    />

                    <SearchableSelectInput
                      nameList={[
                        {
                          name: "tags",
                          title: "Tags",
                          require: "true",
                          inputprops: {
                            name: "tags",
                            id: "tags",
                            options: tagData.length > 0 ? tagData : [],
                            close: false,
                            isMulti: true,
                          },
                        },
                      ]}
                    />

                    <SearchableSelectInput
                      nameList={[
                        {
                          name: "supplier",
                          title: "Supplier",
                          require: "true",
                          inputprops: {
                            name: "supplier",
                            id: "supplier",
                            options: supplierData.length > 0 ? supplierData : [],
                            close: false,
                            isMulti: true
                          },
                        },
                      ]}
                    />

                    <FormBtn loading={loading || isSubmitting} buttonName={buttonName} />
                  </Row>
                </Form>
              )}
            </Formik>
          </CardBody>
        </Card>
      </Col>
    </Row>
  );
};
export default CategoryNewForm;
