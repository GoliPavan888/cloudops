import axios from "axios";
import {
  useParams,
} from "react-router-dom";

import {
  useEffect,
  useState,
} from "react";

export default function UserDetails() {

  const { username } = useParams();

  const [data, setData] =
    useState(null);

  useEffect(() => {

    fetchResources();

  }, []);

  const fetchResources =
    async () => {

    try {

      const roleArn =
        localStorage.getItem(
          "roleArn"
        );

      const response =
        await axios.post(
          "http://localhost:5000/api/users/resources",
          {
            roleArn,
            userName: username,
          }
        );

      setData(response.data);

    } catch (error) {

      console.error(error);
    }
  };

  if (!data) {
    return (
      <div className="text-white p-10">
        Loading...
      </div>
    );
  }

  return (

    <div className="min-h-screen bg-slate-950 text-white p-10">

      <h1 className="text-4xl font-bold">
        {username}
      </h1>

      {/* Policies */}
      <div className="bg-slate-900 mt-10 p-6 rounded-2xl">

        <h2 className="text-2xl font-semibold">
          Attached Policies
        </h2>

        <div className="mt-5 space-y-3">

          {data.policies.map(
            (policy, index) => (

            <div
              key={index}
              className="bg-slate-800 p-4 rounded-xl"
            >
              {policy.PolicyName}
            </div>

          ))}

        </div>

      </div>

      {/* Access Keys */}
      <div className="bg-slate-900 mt-10 p-6 rounded-2xl">

        <h2 className="text-2xl font-semibold">
          Access Keys
        </h2>

        <div className="mt-5 space-y-3">

          {data.accessKeys.map(
            (key, index) => (

            <div
              key={index}
              className="bg-slate-800 p-4 rounded-xl"
            >
              {key.AccessKeyId}
            </div>

          ))}

        </div>

      </div>

      {/* EC2 */}
      <div className="bg-slate-900 mt-10 p-6 rounded-2xl">

        <h2 className="text-2xl font-semibold">
          EC2 Instances
        </h2>

        <p className="mt-4 text-3xl font-bold">
          {data.ec2.length}
        </p>

      </div>

      {/* S3 */}
      <div className="bg-slate-900 mt-10 p-6 rounded-2xl">

        <h2 className="text-2xl font-semibold">
          S3 Buckets
        </h2>

        <p className="mt-4 text-3xl font-bold">
          {data.s3.length}
        </p>

      </div>

      {/* Lambda */}
      <div className="bg-slate-900 mt-10 p-6 rounded-2xl">

        <h2 className="text-2xl font-semibold">
          Lambda Functions
        </h2>

        <p className="mt-4 text-3xl font-bold">
          {data.lambda.length}
        </p>

      </div>
      {/* Activity Timeline */}
<div className="bg-slate-900 mt-10 p-6 rounded-2xl">

  <h2 className="text-2xl font-semibold">
    CloudTrail Activity
  </h2>

  <div className="mt-6 space-y-4">

    {data.activity?.map(
      (event, index) => (

      <div
        key={index}
        className="bg-slate-800 p-5 rounded-xl"
      >

        <div className="flex justify-between">

          <div>

            <p className="text-xl font-semibold">
              {event.eventName}
            </p>

            <p className="text-slate-400 mt-1">
              {event.resource}
            </p>

          </div>

          <div className="text-right">

            <p className="text-blue-400">
              {event.resourceType}
            </p>

            <p className="text-slate-400 text-sm mt-1">
              {new Date(
                event.eventTime
              ).toLocaleString()}
            </p>

          </div>

        </div>

      </div>

    ))}

  </div>

   </div>
    </div>
  );
}