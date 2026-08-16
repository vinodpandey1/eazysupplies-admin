"use client";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import axios from "axios";
import ShowModal from "@/elements/alerts&Modals/Modal";
import Btn from "@/elements/buttons/Btn";
import { useRouter } from "next/navigation";
import { OrderEmailTemp } from "../../utils/constants/index";
import { uploadFiles } from "../../utils/customFunctions/fileUpload";
import Loader from "../commonComponent/Loader";

const OrderViewWithId = ({ id }) => {
    const route = useRouter();
    const [model, setModel] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isApprove, setIsApprove] = useState(false);
    const [isReject, setIsReject] = useState(false);
    const [state, setState] = useState({
        Orders: [],
        qtyTempValue: 0,
        productItemDetails: {},
        editOrderItem: {},
        orderItemQty: 0,
        orderItemPrice: 0,
        refreshState: false,
        shippingModel: false,
        shippingDetails: {},
        shippingProductModel: false,
        shippingProductDetails: {},
        loading: false,
        deliveryAgent: [],
        invoicePdf: "",
        transportReport: "",
        deliveryAgentId: 0,
        deliveryModel: false,
        deliveryFile: ""
    });
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [taxData, setTaxData] = useState();

    const handleStateChange = (name, value) => {
        setState(prev => {
            return { ...prev, [name]: value }
        })
    }

    useEffect(() => {
        const initial = document.body.classList.contains("dark-only");
        setIsDarkMode(initial);
        fetchProduct();
    }, [])

    useEffect(() => {
        const initial = document.body.classList.contains("dark-only");
        setIsDarkMode(initial);
        fetchProduct();
        handleStateChange('refreshState', false);
    }, [state.refreshState])

    const handleView = (el) => {
        handleStateChange('productItemDetails', el);
    }

    const fetchProduct = async () => {
        let res = await axios.get('/api/orders/filter?orderId=' + id, { withCredentials: true });
        if (res.status == 200) {
            //handleStateChange('Orders', res.data.data);
            handleStateChange('productItemDetails', res.data.data);
            setTaxData(res.data.tax);
            handleStateChange("deliveryAgent", res.data.deliveryAgent);
        }

    }
    const handleOrderItemUpdate = async () => {
        try {
            const res = await axios.put('/api/orders/auth', {
                "id": Number(state.editOrderItem?.id),
                "quantity": Number(state.orderItemQty !== 0 ? state.orderItemQty : state.editOrderItem?.quantity),
                "price": Number(state.orderItemPrice !== 0 ? state.orderItemPrice : state.editOrderItem?.price)
            }, { withCredentials: true });
            if (res.status == 200) {
                alert("Order item updated successfully!");
                // window.location.reload();
                handleStateChange('refreshState', true);
            }
        } catch (err) {
            console.log('error', err);
        }
    }
    const orderItemEdit = (el) => {
        handleStateChange('editOrderItem', el);
        handleStateChange('orderItemQty', el?.quantity);
        handleStateChange('orderItemPrice', el?.price);
    }

    const updateOrderStatus = async (id, action) => {
        try {
            action == "APPROVED" ? setIsApprove(true) : setIsReject(true);
            const res = await axios.put('/api/orders', {
                id: Number(id),
                status: action.toUpperCase(),
                approved: action.toUpperCase() === "APPROVED"
            }, { withCredentials: true });

            if (res.status === 200) {
                alert(`Order ${action.toUpperCase()} successfully!`);
                let res = await axios.get('/api/invoice?orderId=' + id, { withCredentials: true });
                handleStateChange('refreshState', true);
            }
            action == "APPROVED" ? setIsApprove(false) : setIsReject(false);
        } catch (err) {
            console.error('error', "Something went wrong, please try again!");
            action == "APPROVED" ? setIsApprove(false) : setIsReject(false);
        }
    };
    function generateProductDiscount(product, ordId) {
        let jsonData = product.jsonData;
        let _dd = [];
        if (!jsonData) {
            _dd = [{ discountPercentage: 0, discountAmount: 0, taxId: 0, taxAmount: 0, taxpercent: 0, totalPrice: 0 }];
            let _taxId = Number(product?.tax);
            let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
            _taxpercent = _taxpercent[0].value;
            let _taxAmt = Number(product?.price) * Number(_taxpercent) / 100;
            _dd[0].taxAmount = _taxAmt;
            _dd[0].taxpercent = _taxpercent;
            _dd[0].totalPrice = Number(product?.price) + _taxAmt;
            return _dd[0];
        }
        else {
            _dd = jsonData.filter(el => el.orderId == ordId);
            if (_dd.length > 0) {
                let _taxId = Number(product?.tax);
                let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
                _taxpercent = _taxpercent[0].value;
                let _taxAmt = Number(_dd[0].sellingPrice) * Number(_taxpercent) / 100;
                _dd[0].taxAmount = _taxAmt;
                _dd[0].taxpercent = _taxpercent;
                _dd[0].totalPrice = Number(_dd[0].sellingPrice) + _taxAmt;
                return _dd[0];
            }
        }
    }

    function generateProductTotalPrice(order) {
        let total = 0;
        for (let data of order.items) {
            let jsonData = data.product.jsonData;
            if (!jsonData) {
                let _taxId = Number(data.product?.tax);
                let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
                _taxpercent = _taxpercent[0].value;
                let _taxAmt = Number(data.product?.price) * Number(_taxpercent) / 100;
                total += (Number(data.product?.price) + _taxAmt) * data.quantity;
            }
            else {
                let _dd = jsonData.filter(el => el.orderId == order.id);
                if (_dd.length > 0) {
                    let _taxId = Number(data.product?.tax);
                    let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
                    _taxpercent = _taxpercent[0].value;
                    let _taxAmt = Number(_dd[0].sellingPrice) * Number(_taxpercent) / 100;
                    total += (Number(_dd[0].sellingPrice) + _taxAmt) * data.quantity;
                }
            }
        }
        return total;
    }

    const handleHtmlToPdf1 = async (id) => {
        function generateProductRows(products) {
            return products.map(p => `
    <tr>
      <td>${p?.product?.name}</td>
      <td>${p?.quantity}</td>
      <td>₹${p?.product?.price.toFixed(2)}</td>
      <td>${generateProductDiscount(p.product, id)?.discountPercentage}</td>
      <td>${(Number(generateProductDiscount(p.product, id)?.discountAmount) * Number(p?.quantity)).toFixed(2)}</td>
      <td>${generateProductDiscount(p.product, id)?.taxpercent}</td>
      <td>${(Number(generateProductDiscount(p.product, id)?.taxAmount) * Number(p?.quantity)).toFixed(2)}</td>
      <td>${Number(generateProductDiscount(p.product, id)?.totalPrice * Number(p?.quantity)).toFixed(2)}</td>
    </tr>
  `).join("");
        }

        let OrderTemp = OrderEmailTemp;
        let shippingAdds = state.productItemDetails?.shipping.address + ', ' + state.productItemDetails?.shipping?.city + ', ' + state.productItemDetails?.shipping?.country;
        let subTotal = 0, Total = 0, tax = 0;
        for (const el of state.productItemDetails?.items) {
            Total += Number(generateProductDiscount(el.product, id).totalPrice * Number(el.quantity));
        }
        const productRows = generateProductRows(state.productItemDetails?.items);
        const userId = state?.productItemDetails?.user?.id;
        OrderTemp = OrderTemp.replace('@Order', id);
        OrderTemp = OrderTemp.replace('@OrderDate', state?.productItemDetails?.createdAt.slice(0, -14));
        OrderTemp = OrderTemp.replace('@ShippingAddress', shippingAdds);
        OrderTemp = OrderTemp.replace('@PaymentStatus', state.productItemDetails?.payment?.status);
        OrderTemp = OrderTemp.replace('@ProductBody', productRows);
        OrderTemp = OrderTemp.replace('@totalOrderAmount', Total.toFixed(2));
        const res = await axios.post('/api/file/htmlToPdf', {
            orderId: Number(id),
            userId: userId,
            html: OrderTemp
        }, { withCredentials: true });

    }

    const handleHtmlToPdf = async (id, popup = true) => {
        setIsLoading(true);
        if (popup) window.open(`/api/invoice/${id}/pdf`, "_blank", "noopener,noreferrer");
        setIsLoading(false);
    }

    const handlePayment = (id) => {
        // let Total = 0;
        // for (const el of state.productItemDetails?.items) {
        //     Total += Number(generateProductDiscount(el.product, id).totalPrice * Number(el.quantity));
        // }
        route.push('/payment/edit/' + id);
    }

    const handleShipping = async (id) => {
        if (state.productItemDetails?.invoicepath != null || state.productItemDetails?.invoicepath != '') {
            handleStateChange('shippingProductModel', true);
        } else {
            await handleHtmlToPdf(id, false);
            await fetchProduct();
            handleStateChange('shippingProductModel', true);
        }
    }
    const handleShippingSubmit = async () => {
        if (state.deliveryAgentId == 0) {
            alert("Delivery Agent is mandatory!");
        } else {
            let invoicePdfRes = "";
            // if(state.invoicePdf != ""){}
            // let formData = new FormData();
            // formData.append("file", state.invoicePdf);
            //  invoicePdfRes = await axios.post(
            //     "/api/file/upload?type=2&namePath=transport",
            //     formData,
            //     {
            //         headers: { "Content-Type": "multipart/form-data" },
            //         withCredentials: true
            //     }
            // );
            // if (invoicePdfRes.status === 200) {
            setIsLoading(true);
            let reportPath = '';
            if (state.transportReport != "") {
                let formData = new FormData();
                formData.append("file", state.transportReport);
                const reportRes = await axios.post(
                    "/api/file/upload?type=2&namePath=transport&orderId=" + state.productItemDetails?.id,
                    formData,
                    {
                        headers: { "Content-Type": "multipart/form-data" },
                        withCredentials: true
                    }
                );
                if (reportRes.status != 200) {
                    alert("Failed to upload transport report, please try again!");
                    setIsLoading(false);
                    return;
                }
                reportPath = reportRes?.data?.url;
            }
            const updateShipping = await axios.put(
                "/api/shippings",
                {
                    id: Number(state.productItemDetails?.shipping?.id),
                    assets: `${"invoicePdf: " + state.productItemDetails?.invoicepath},${"transportReport:" + reportPath}`,
                    deliveryAgent: state.deliveryAgentId,
                    status: "SHIPPED",
                    orderId: Number(state.productItemDetails?.id)
                },
                { withCredentials: true }
            );
            if (updateShipping.status === 200) {
                alert("Shipping process started successfully!");
                handleStateChange('shippingProductModel', false);
                fetchProduct();
                setIsLoading(false);
            } else {
                alert("Failed to upload transport report, please try again!");
                setIsLoading(false);
            }
            // } else {
            //     alert("Failed to upload invoice pdf, please try again!");
            // }
        }
    }

    const handleDelivery = (id) => {
        handleStateChange("deliveryModel", true);
    }

    const handleDeliverySubmit = async () => {
        if (state.deliveryFile == "") {
            alert("Please upload file to complete delivery!");
        } else {
            setIsLoading(true);
            let formData = new FormData();
            formData.append("file", state.deliveryFile);
            const deliveredFile = await axios.post(
                "/api/file/upload?type=2&namePath=delivery&orderId=" + state.productItemDetails?.id,
                formData,
                {
                    headers: { "Content-Type": "multipart/form-data" },
                    withCredentials: true
                }
            );

            if (deliveredFile.status == 200) {
                const orders = await axios.put('/api/orders/filter?id=' + Number(state.productItemDetails?.id), {
                    "status": "COMPLETED",
                    "delivered": true,
                    "deliveryAgentAssets": `${deliveredFile?.data?.url}`
                }, { withCredentials: true });
                if (orders.status == 200) {
                    alert('Order: ' + state.productItemDetails?.id + " completed successfully!");
                    handleStateChange("deliveryModel", false);
                    fetchProduct();
                }
                setIsLoading(false);
            }
        }
    }

    if (isLoading) return <Loader />;
    return (
        <>
            <div>
                Orders Details
            </div>
            <div className="d-flex" style={{ width: "100%", height: "100vh" }}>
                <div className="flex-grow-1 p-3">
                    <div className="w-100 d-flex justify-content-between mb-2">
                        <p>Order ID: {state.productItemDetails?.id}</p>
                        {
                            Object.keys(state.productItemDetails).length > 0 &&
                            <div className="d-flex justify-content-end gap-3 pr-3">
                                {state.productItemDetails?.approved && state.productItemDetails?.status.toUpperCase() === "SHIPPED" && state.productItemDetails?.shipping?.status.toUpperCase() === "SHIPPED" && <button type="button" onClick={() => handleDelivery(state.productItemDetails?.id)} className="btn btn-info">Delivery</button>}
                                {state.productItemDetails?.approved && state.productItemDetails?.status.toUpperCase() === "PAID" && <button type="button" onClick={() => handleShipping(state.productItemDetails?.id)} className="btn btn-info">Shipping</button>}
                                {state.productItemDetails?.status.toUpperCase() === "APPROVED" && state.productItemDetails?.payment?.method == "OFF" && state.productItemDetails?.approved && <button type="button" onClick={() => handlePayment(state.productItemDetails?.payment?.id)} className="btn btn-info">Payment Offline</button>}

                                {state.productItemDetails?.approved ? <button type="button" className="btn btn-success" disabled title="disabled" >Approved</button> : (state.productItemDetails?.status).toUpperCase() === "PENDING" ? <button type="button" className="btn btn-success" onClick={() => updateOrderStatus(state.productItemDetails?.id, "APPROVED")} disabled={isApprove} >
                                    {isApprove ? (
                                        <>
                                            <span
                                                className="spinner-border spinner-border-sm me-2"
                                                role="status"
                                                aria-hidden="true"
                                            ></span>
                                            Approving...
                                        </>
                                    ) : (
                                        "Approve"
                                    )}
                                </button> : ''}
                                {(state.productItemDetails?.status).toUpperCase() === "REJECTED" ? <button type="button" className="btn btn-danger" disabled >Rejected</button> : (state.productItemDetails?.status).toUpperCase() === "PENDING" && !state.productItemDetails?.approved ? <button type="button" className="btn btn-danger" onClick={() => updateOrderStatus(state.productItemDetails?.id, "REJECTED")} disabled={isReject} >
                                    {isReject ? (
                                        <>
                                            <span
                                                className="spinner-border spinner-border-sm me-2"
                                                role="status"
                                                aria-hidden="true"
                                            ></span>
                                            Cancelling...
                                        </>
                                    ) : (
                                        "Reject"
                                    )}
                                </button> : ''}
                                {(state.productItemDetails?.approved && ["COMPLETED", "SHIPPED", "PAID"].includes(state.productItemDetails?.status.toUpperCase())) ? <button type="button" className="btn btn-success" title="invoice" onClick={() => handleHtmlToPdf(state.productItemDetails?.id)} >Invoice </button> : ''}
                                {/* {state.productItemDetails?.approved && state.productItemDetails?.status.toUpperCase() === "SHIPPED" && state.productItemDetails?.shipping?.status.toUpperCase() === "SHIPPED" && <a href={state.productItemDetails?.shipping?.assets?.split(',').find(v => v.startsWith('transportReport:'))?.split('transportReport:')[1]} className="btn btn-info">Transport Report</a>} */}
                                {state.productItemDetails?.approved &&
                                    (state.productItemDetails?.status?.toUpperCase() === "SHIPPED" || state.productItemDetails?.status?.toUpperCase() === "COMPLETED") &&
                                    (state.productItemDetails?.shipping?.status?.toUpperCase() === "SHIPPED") && (
                                        <a
                                            href={
                                                state.productItemDetails?.shipping?.assets
                                                    ?.split(',')
                                                    .find(v => v.startsWith('transportReport:'))
                                                    ?.split('transportReport:')[1]
                                            }
                                            className="link-primary fw-semibold text-decoration-underline"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Transport
                                        </a>
                                    )}

                                {state.productItemDetails?.approved &&
                                    state.productItemDetails?.status?.toUpperCase() === "COMPLETED" &&
                                    state.productItemDetails?.shipping?.status?.toUpperCase() === "SHIPPED" && (
                                        <a
                                            href={
                                                state.productItemDetails?.shipping?.assets
                                                    ?.split(',')
                                                    .find(v => v.startsWith('transportReport:'))
                                                    ?.split('transportReport:')[1]
                                            }
                                            className="link-primary fw-semibold text-decoration-underline"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            delivery doc
                                        </a>
                                    )}

                                {/* <a
                                    href={
                                        state.productItemDetails?.shipping?.assets
                                            ?.split(',')
                                            .find(v => v.startsWith('transportReport:'))
                                            ?.split('transportReport:')[1]
                                    }
                                    className="link-primary fw-semibold text-decoration-underline"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Delivery Doc
                                </a> */}

                            </div>
                        }
                    </div>

                    {state.productItemDetails?.items?.length > 0 ? (
                        state.productItemDetails.items.map((el, index) => {
                            const quantity = Number(el?.quantity || 0);
                            const price = Number(el?.product?.price || 0);

                            const amtDetails = generateProductDiscount(el?.product, el.orderId) || {};
                            const deliveryAgentFilter = state.deliveryAgent?.filter(el => el.id == Number(state.productItemDetails?.deliveryAgent));
                            const {
                                discountPercentage = 0,
                                discountAmount = 0,
                                taxpercent = 0,
                                taxAmount = 0,
                                totalPrice = price - discountAmount + taxAmount
                            } = amtDetails;

                            return (
                                <div key={index} className="card shadow-sm mb-4 border-0">
                                    <div className="card-body p-4">

                                        {/* Header */}
                                        <div className="d-flex justify-content-between align-items-center mb-3">
                                            <h4 className="fw-bold text-primary m-0">{el?.product?.name}</h4>
                                            <span className="badge bg-secondary">Order #{el?.orderId}</span>
                                        </div>

                                        {/* Dates */}
                                        <div className="d-flex gap-2 text-muted small mb-4">
                                            <div>
                                                <strong>Ordered:</strong>{" "}
                                                {el?.createdAt ? new Date(el.createdAt).toLocaleDateString() : "-"}
                                            </div>
                                            <div>
                                                <strong>Updated:</strong>{" "}
                                                {el?.updatedAt ? new Date(el.updatedAt).toLocaleDateString() : "-"}
                                            </div>
                                            <div>
                                                <strong>Payment:</strong>{" "}
                                                {state.productItemDetails?.payment?.status.toUpperCase()}
                                            </div>
                                            <div>
                                                <strong>Shipping:</strong>{" "}
                                                {state.productItemDetails?.shipping?.status.toUpperCase()}
                                            </div>
                                            <div>
                                                <strong>Delivery Agent: {deliveryAgentFilter.length > 0 ? deliveryAgentFilter[0]?.name : "NA"}</strong>{" "}
                                            </div>
                                        </div>

                                        {/* Content Section */}
                                        <div className="row g-3">

                                            {/* Left Column */}
                                            <div className="col-md-6">
                                                <div className="p-3 rounded">
                                                    <p><strong>Price per unit:</strong> ₹{price}</p>
                                                    <p><strong>Quantity:</strong> {quantity}</p>

                                                    {state.editOrderItem?.id === el.id && (
                                                        <input
                                                            type="number"
                                                            className="form-control mt-2"
                                                            placeholder="Enter Quantity"
                                                            value={state.orderItemQty}
                                                            onChange={(e) =>
                                                                handleStateChange("orderItemQty", e.target.value)
                                                            }
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            {/* Right Column */}
                                            <div className="col-md-6">
                                                <div className="p-3 rounded ">
                                                    <p><strong>Discount:</strong> {discountPercentage}%</p>
                                                    <p><strong>Discount Amount:</strong> ₹{(discountAmount * quantity).toFixed(2)}</p>

                                                    <p><strong>Tax:</strong> {taxpercent}%</p>
                                                    <p><strong>Tax Amount:</strong> ₹{(taxAmount * quantity).toFixed(2)}</p>

                                                    <p><strong>Subtotal:</strong> ₹{((price - discountAmount) * quantity).toFixed(2)}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Footer */}
                                        <div className="d-flex justify-content-between align-items-center mt-4">
                                            <h3 className="fw-bold text-success">
                                                Total: ₹{(quantity * totalPrice).toFixed(2)}
                                            </h3>

                                            {/* Edit Button */}
                                            {/* Uncomment if needed */}
                                            {!state.productItemDetails?.approved && state.productItemDetails?.status.toUpperCase() === "PENDING" &&
                                                (state.editOrderItem?.id !== el.id ? (
                                                    <button
                                                        className="btn btn-outline-primary btn-sm"
                                                        onClick={() => orderItemEdit(el)}
                                                    >
                                                        Edit
                                                    </button>
                                                ) : (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={handleOrderItemUpdate}
                                                    >
                                                        Update
                                                    </button>
                                                ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <p className="text-center text-muted py-5">No order items found.</p>
                    )}


                </div>
            </div>
            <ShowModal
                open={state.shippingModel}
                close={false}
                buttons={
                    <>
                        <Btn title="Close" onClick={() => {
                            setState(prev => {
                                return { ...prev, ["shippingModel"]: false, ["shippingDetails"]: {} }
                            })
                        }} className="btn-md btn-outline fw-bold" />
                        {/* <Btn title="Yes" onClick={() => handleLogout()} className="btn-theme btn-md fw-bold" /> */}
                    </>
                }
            >
                {/* <div className="remove-box"> */}
                {
                    Object.keys(state.shippingDetails).length > 0 ?
                        <div>
                            <p>Status: {state.shippingDetails?.status}</p>
                            <p style={{ color: "#0b24ed" }}>Address: {state.shippingDetails?.address}, {state.shippingDetails?.city}, {state.shippingDetails?.state},
                                {state.shippingDetails?.country}- {state.shippingDetails?.postalCode}
                            </p>
                        </div>
                        : <p>No Shipping address available</p>
                }
                {/* </div> */}
            </ShowModal>
            <ShowModal
                open={state.shippingProductModel}
                close={false}
                buttons={
                    <>
                        <Btn title="Close" onClick={() => {
                            setState(prev => {
                                return { ...prev, ["shippingProductModel"]: false, ["shippingProductDetails"]: "" }
                            })
                        }} className="btn-md btn-outline fw-bold" />
                        <Btn title="Save" className="btn-theme btn-md fw-bold" onClick={handleShippingSubmit} />
                    </>
                }
            >
                <div className="p-3">
                    <select
                        className="form-select"
                        name="deliveryAgent"
                        value={state.deliveryAgentId}
                        onChange={(e) =>
                            handleStateChange("deliveryAgentId", Number(e.target.value))
                        }
                    >
                        <option value="" defaultChecked>
                            Select delivery agent
                        </option>

                        {state.deliveryAgent?.map((el, i) => (
                            <option key={"agent" + i} value={el.id}>
                                {el.name}
                            </option>
                        ))}
                    </select>

                    {/* Invoice PDF */}
                    <div className="pt-3 pb-3">
                        <label htmlFor="invoicePdf" className="form-label fw-semibold">
                            Invoice PDF
                        </label>

                        {/* <input
                            type="file"
                            name="invoicePdf"
                            id="invoicePdf"
                            className="form-control"
                            accept="application/pdf"
                            onChange={(e) =>
                                handleStateChange("invoicePdf", e.target.files[0])
                            }
                        /> */}
                        <div className="d-flex justify-content-end">
                            <a href={state.productItemDetails?.invoicepath} target="_blank" id="invoicePdf" >Invoice</a>
                        </div>
                    </div>

                    {/* Transport Report */}
                    <div className="mb-3">
                        <label htmlFor="transportReport" className="form-label fw-semibold">
                            Transport Report
                        </label>

                        <input
                            type="file"
                            name="transportReport"
                            id="transportReport"
                            className="form-control"
                            onChange={(e) =>
                                handleStateChange("transportReport", e.target.files[0])
                            }
                        />
                    </div>

                </div>
            </ShowModal>
            <ShowModal
                open={state.deliveryModel}
                close={false}
                buttons={
                    <>
                        <Btn title="Close" onClick={() => {
                            setState(prev => {
                                return { ...prev, ["deliveryModel"]: false, ["deliveryFile"]: "" }
                            })
                        }} className="btn-md btn-outline fw-bold" />
                        <Btn title="Save" className="btn-theme btn-md fw-bold" onClick={handleDeliverySubmit} />
                    </>
                }
            >
                <div className="p-3">
                    <div className="mb-3">
                        <label htmlFor="deliveryFile" className="form-label fw-semibold">
                            Delivered file
                        </label>

                        <input
                            type="file"
                            name="deliveryFile"
                            id="deliveryFile"
                            className="form-control"
                            onChange={(e) =>
                                handleStateChange("deliveryFile", e.target.files[0])
                            }
                        />
                    </div>

                </div>
            </ShowModal>
        </>
    )
};

export default OrderViewWithId;
